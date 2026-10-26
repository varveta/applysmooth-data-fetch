import { restoreRunnerCache, saveRunnerCache } from "./lib/runner-cache";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { openStore, startRun, finishRun } from "./lib/store";
import { remoteState } from "./lib/remote-state";
import { remoteWriter } from "./lib/remote-writer";
import { restoreCheckpoint, saveCheckpoint } from "./lib/checkpoint";
import { buildPlan, applyPlan, type PublishPlan } from "./lib/publish";
import { fetchAll, syncTargets, type Target } from "./lib/fetch";
import { gateAll } from "./lib/gate";

async function main() {
  if (
    process.env.GITHUB_REPOSITORY !== "varveta/applysmooth-data-fetch" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !["workflow_dispatch", "schedule"].includes(
      process.env.GITHUB_EVENT_NAME ?? "",
    )
  )
    throw Error("Untrusted runner context");
  const endpoint = process.env.COLLECTOR_ENDPOINT,
    token = process.env.COLLECTOR_TOKEN,
    cacheKey = process.env.COLLECTOR_CACHE_KEY;
  if (!endpoint || !token || token.length < 32 || !cacheKey)
    throw Error("Missing configuration");
  const lease = randomUUID(),
    state = remoteState(endpoint + "/state", token, lease);
  const initial = await state.acquire();
  let generation = initial.generation;
  let manifest = initial.manifest;
  mkdirSync("ingest/data", { recursive: true });
  const file = "ingest/data/online.sqlite";
  const cacheFile = "ingest/data/runner-cache.bin";
  const cacheHit = restoreRunnerCache(cacheFile, file, manifest, cacheKey);
  if (!cacheHit) await restoreCheckpoint(file, manifest, state.storage);
  console.log(
    JSON.stringify({
      checkpointCache: cacheHit ? "verified-hit" : "private-storage-fallback",
      restoredGeneration: generation,
      privateDownloadBytes: cacheHit
        ? 0
        : manifest.chunks.reduce((n, c) => n + c.bytes, 0),
    }),
  );
  let db = openStore(file);
  let fetchedOK = false,
    publishedOK = false;
  const writer = remoteWriter(
    endpoint,
    token,
    "supabase:qhilcyvwvesqfuykdows",
    lease,
  );
  const persist = async () => {
    db.close();
    const m = await saveCheckpoint(file, generation, state.storage);
    generation = m.generation;
    manifest = m;
    db = openStore(file);
  };
  try {
    db.exec(
      "create table if not exists online_pending (id integer primary key check(id=1), run_id integer not null, plan text not null)",
    );
    // Replay the durable pre-publish plan before fetching: ambiguous responses cannot change identities.
    const pending = db
      .prepare("select run_id,plan from online_pending where id=1")
      .get() as { run_id: number; plan: string } | undefined;
    if (pending) {
      await applyPlan(
        db,
        pending.run_id,
        JSON.parse(pending.plan) as PublishPlan,
        writer,
        10,
      );
      db.exec("delete from online_pending");
      await persist();
    }
    const targets = (
      JSON.parse(readFileSync("ingest/config/targets.json", "utf8")) as {
        targets: Target[];
      }
    ).targets;
    syncTargets(db, targets);
    const run = startRun(db, "daily", {});
    const fetched = await fetchAll(db, run, { only: targets }, () => {});
    fetchedOK = fetched.failed === 0 && fetched.errors === 0;
    if (!fetchedOK) {
      finishRun(db, run, { failed: true, fetch: fetched });
      await persist();
      throw Error("Incomplete fetch; publication skipped");
    }
    const gate = gateAll(db, run);
    const scoped = new Set<string>();
    for (const target of targets)
      for (const row of db
        .prepare("select id from postings where source=? and tenant=?")
        .all(target.source, target.tenant))
        scoped.add(String(row.id));
    const plan = buildPlan(db, new Date(), 40, writer.label, true, scoped);
    if (plan.withdraw.length > 10) throw Error("Withdrawal circuit breaker");
    db.prepare("insert into online_pending(id,run_id,plan) values(1,?,?)").run(
      run,
      JSON.stringify(plan),
    );
    await persist();
    const result = await applyPlan(db, run, plan, writer, 10);
    db.exec("delete from online_pending");
    const counts = {
      fetched: fetched.listed,
      changed: fetched.changed,
      accepted: gate.counts.accepted ?? 0,
      rejected: gate.counts.rejected ?? 0,
      quarantined: gate.counts.quarantined ?? 0,
      duplicate: gate.reasonCounts.duplicate ?? 0,
      publish: result,
      failed: 0,
    };
    finishRun(db, run, counts);
    await persist();
    publishedOK = true;
    console.log(JSON.stringify(counts));
  } finally {
    try {
      db.close();
    } catch {}
    await state.finish(fetchedOK, publishedOK, !publishedOK);
    if (publishedOK) saveRunnerCache(file, cacheFile, manifest, cacheKey);
  }
}
main().catch(() => {
  console.error(
    "Collector failed; checkpoint retained; inspect backend status before retry",
  );
  process.exitCode = 1;
});
