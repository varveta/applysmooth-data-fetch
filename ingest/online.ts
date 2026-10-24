import { readFileSync, mkdirSync } from "node:fs";
import { openStore, startRun, finishRun } from "./lib/store";
import { syncTargets, fetchAll, type Target } from "./lib/fetch";
import { gateAll } from "./lib/gate";
import { buildPlan } from "./lib/publish";

// Rehearsal is deliberately credential-free and never calls the backend.
async function main() {
  if (process.argv.slice(2).length) throw Error("Rehearsal accepts no flags");
  mkdirSync("ingest/data", { recursive: true });
  const db = openStore("ingest/data/rehearsal.sqlite");
  const run = startRun(db, "rehearsal", {});
  const started = Date.now();
  try {
    const { targets } = JSON.parse(
      readFileSync("ingest/config/targets.json", "utf8"),
    ) as { targets: Target[] };
    syncTargets(db, targets);
    const fetched = await fetchAll(db, run, {}, () => {});
    const gate = gateAll(db, run);
    const plan = buildPlan(db, new Date(), 40, "supabase:qhilcyvwvesqfuykdows");
    const counts = {
      fetched: fetched.listed,
      changed: fetched.changed,
      accepted: gate.counts.accepted ?? 0,
      rejected: gate.counts.rejected ?? 0,
      quarantined: gate.counts.quarantined ?? 0,
      duplicate: gate.reasonCounts.duplicate ?? 0,
      wouldPublish: plan.publish.length,
      published: 0,
      withdrawn: 0,
      failed: fetched.failed + fetched.errors,
      durationMs: Date.now() - started,
    };
    finishRun(db, run, counts);
    console.log(JSON.stringify(counts));
    if (counts.failed) process.exitCode = 1;
  } finally {
    db.close();
  }
}
main().catch(() => {
  console.error("Rehearsal failed; no catalog writes attempted");
  process.exitCode = 1;
});
