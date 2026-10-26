import { pathToFileURL } from "node:url";
import { z } from "zod";
import { assertRunnerContext, clientFromEnv, type RequestMetrics } from "./lib/collector-client";
import { CollectorError, errorLine, type Stage } from "./lib/diagnostics";

const count = z.number().int().nonnegative().safe();
const LifecycleResult = z.object({
  archived: count, deleted: count, tombstoned: count, delete_enabled: z.boolean(),
}).refine((result) => result.delete_enabled || result.deleted === 0,
  "Deletion-disabled lifecycle response must have deleted=0");

export async function runLifecycle(options: {
  client: { call(body: unknown, options?: { attempts?: number }): Promise<unknown>; metrics: RequestMetrics };
  apply?: boolean;
  archiveLimit?: number;
  deleteLimit?: number;
  log?: (line: string) => void;
}) {
  const apply = z.boolean().parse(options.apply ?? false);
  const archiveLimit = count.parse(options.archiveLimit ?? 5000);
  const deleteLimit = count.parse(options.deleteLimit ?? 1000);
  const log = options.log ?? console.log;
  const started = Date.now();
  let stage: Stage = "lifecycle_dry_run";
  try {
    const preview = LifecycleResult.parse(await options.client.call({ operation: "lifecycle_run", dry_run: true }));
    log(JSON.stringify({ stage, board: "run", ...preview, archive_limit: archiveLimit, delete_limit: deleteLimit }));
    if (preview.archived > archiveLimit || preview.deleted > deleteLimit)
      throw new CollectorError(`Lifecycle dry run exceeds limits: archive ${preview.archived}/${archiveLimit}, delete ${preview.deleted}/${deleteLimit}; nothing applied`);
    let actual: z.infer<typeof LifecycleResult> | null = null;
    if (apply) {
      stage = "lifecycle_apply";
      // No run/batch id in this contract: an ambiguous apply must not be blindly replayed.
      actual = LifecycleResult.parse(await options.client.call({ operation: "lifecycle_run", dry_run: false }, { attempts: 1 }));
      log(JSON.stringify({ stage, board: "run", ...actual }));
    }
    const summary = {
      applied: apply, preview, actual, duration_ms: Date.now() - started,
      requests: options.client.metrics.requests, payload_bytes: options.client.metrics.payload_bytes,
    };
    log(JSON.stringify({ stage: "complete", board: "run", ...summary }));
    return summary;
  } catch (error) { log(errorLine(stage, "run", error)); throw error; }
}

export function lifecycleOptionsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const apply = env.LIFECYCLE_APPLY ?? "false";
  if (apply !== "true" && apply !== "false") throw new CollectorError("LIFECYCLE_APPLY must be true or false");
  return {
    apply: apply === "true",
    archiveLimit: env.LIFECYCLE_ARCHIVE_LIMIT === undefined ? 5000 : count.parse(Number(env.LIFECYCLE_ARCHIVE_LIMIT)),
    deleteLimit: env.LIFECYCLE_DELETE_LIMIT === undefined ? 1000 : count.parse(Number(env.LIFECYCLE_DELETE_LIMIT)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    assertRunnerContext();
    await runLifecycle({ client: clientFromEnv(), ...lifecycleOptionsFromEnv() });
  })().catch((error) => { console.error(errorLine("complete", "run", error)); process.exitCode = 1; });
}
