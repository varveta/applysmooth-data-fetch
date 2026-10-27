import { pathToFileURL } from "node:url";
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
import { CollectorError, errorLine, type Stage } from "./lib/diagnostics";

// Diagnostics only: preserve the archive-backed path until stateless acceptance passes.
let stage: Stage = "restore";
let board = "run";

const reportedErrors = new Set<unknown>();
function reportOnce(error: unknown) {
  if (reportedErrors.has(error)) return;
  reportedErrors.add(error);
  console.error(errorLine(stage, board, error));
}

async function main() {
  if (
    process.env.GITHUB_REPOSITORY !== "varveta/applysmooth-data-fetch" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !["workflow_dispatch", "schedule"].includes(
      process.env.GITHUB_EVENT_NAME ?? "",
    )
  )
    throw new CollectorError("Untrusted runner context");
  const endpoint = process.env.COLLECTOR_ENDPOINT,
    token = process.env.COLLECTOR_TOKEN,
    cacheKey = process.env.COLLECTOR_CACHE_KEY;
  if (!endpoint || !token || token.length < 32 || !cacheKey)
    throw new CollectorError("Missing configuration");
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
    const previousStage = stage;
    stage = "checkpoint";
    db.close();
    const m = await saveCheckpoint(file, generation, state.storage);
    generation = m.generation;
    manifest = m;
    db = openStore(file);
    stage = previousStage;
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
      stage = "publish";
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
    stage = "fetch";
    const targets = (
      JSON.parse(readFileSync("ingest/config/targets.json", "utf8")) as {
        targets: Target[];
      }
    ).targets;
    board = targets.map((target) => `${target.source}:${target.tenant}`).join(",");
    syncTargets(db, targets);
    const run = startRun(db, "daily", {});
    const fetched = await fetchAll(db, run, { only: targets }, (line) => {
      const failure = /^(?:FAIL|ERROR) (\S+) (.*)/.exec(line);
      if (failure) console.error(errorLine("fetch", failure[1], new Error(failure[2])));
    });
    fetchedOK = fetched.failed === 0 && fetched.errors === 0;
    if (!fetchedOK) {
      finishRun(db, run, { failed: true, fetch: fetched });
      await persist();
      throw new CollectorError("Incomplete fetch; publication skipped");
    }
    const gate = gateAll(db, run);
    stage = "publish";
    const scoped = new Set<string>();
    for (const target of targets)
      for (const row of db
        .prepare("select id from postings where source=? and tenant=?")
        .all(target.source, target.tenant))
        scoped.add(String(row.id));
    const plan = buildPlan(db, new Date(), 40, writer.label, true, scoped);
    if (plan.withdraw.length > 10) throw new CollectorError("Withdrawal circuit breaker");
    db.prepare("insert into online_pending(id,run_id,plan) values(1,?,?)").run(
      run,
      JSON.stringify(plan),
    );
    await persist();
    const result = await applyPlan(db, run, plan, writer, 10);
    stage = "complete";
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
  } catch (error) {
    // Preserve the original failure even if finishing the remote lease also fails.
    reportOnce(error);
    throw error;
  } finally {
    try {
      db.close();
    } catch {}
    stage = "complete";
    await state.finish(fetchedOK, publishedOK, !publishedOK);
    if (publishedOK) {
      stage = "checkpoint";
      saveRunnerCache(file, cacheFile, manifest, cacheKey);
    }
  }
}
export async function runScheduled() {
  stage = "restore";
  board = "run";
  reportedErrors.clear();
  try { await main(); }
  catch (error) { reportOnce(error); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScheduled().catch(() => { process.exitCode = 1; });
}
