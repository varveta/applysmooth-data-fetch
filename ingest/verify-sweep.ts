import { pathToFileURL } from "node:url";
import { z } from "zod";
import { assertRunnerContext, clientFromEnv } from "./lib/collector-client";
import { CollectorError, errorLine } from "./lib/diagnostics";
import { createVerificationCache, runVerification } from "./verify";

/** Drain a larger daily queue without refetching board feeds or retrying the same job. */
export async function runVerificationSweep(options: Parameters<typeof runVerification>[0] & { maxBatches?: number }) {
  const limit = z.number().int().min(1).max(500).parse(options.limit ?? 500);
  const maxBatches = z.number().int().min(1).max(20).parse(options.maxBatches ?? 20);
  const cache = createVerificationCache();
  const seenIds = new Set<string>();
  const log = options.log ?? console.log;
  const started = Date.now();
  const results = [];
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await runVerification({ ...options, limit, cache, seenIds });
    results.push(result);
    if (result.jobs_checked < limit) {
      const summary = { stage: "complete", board: "daily-sweep", batches: results.length,
        jobs_checked: seenIds.size, recorded: results.reduce((n, r) => n + r.recorded, 0),
        withdrawn: results.reduce((n, r) => n + r.withdrawn, 0), flagged: results.reduce((n, r) => n + r.flagged, 0),
        source_and_link_requests: results.reduce((n, r) => n + r.source_and_link_requests, 0),
        collector_requests: options.client.metrics.requests, duration_ms: Date.now() - started };
      log(JSON.stringify(summary));
      return summary;
    }
  }
  throw new CollectorError("Daily verification reached its 10000-job capacity; review the remaining queue");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  (async () => {
    assertRunnerContext();
    await runVerificationSweep({ client: clientFromEnv() });
  })().catch((error) => { console.error(errorLine("complete", "daily-sweep", error)); process.exitCode = 1; });
