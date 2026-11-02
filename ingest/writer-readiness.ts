import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { SOURCE_IDS } from "@/lib/jobs-ingest/contract";
import { TargetSchema } from "./stateless";

export const VERIFIED_TEST_ENDPOINT = "https://applysmooth-git-test-abhinaya-veerapaneni-s-projects.vercel.app/api/jobs-collector";
export const MAX_RESPONSE_BYTES = 8192;
export const REQUEST_TIMEOUT_MS = 10_000;
/** Audited active configuration and persisted database scopes on November 2, 2026. */
export const AUDITED_BOARDS = [
  "ashby:cohere", "ashby:decagon", "ashby:elevenlabs", "ashby:harvey", "ashby:modal",
  "ashby:openai", "ashby:ramp", "ashby:replit", "ashby:sierra", "ashby:snowflake",
  "greenhouse:airbnb", "greenhouse:andurilindustries", "greenhouse:anthropic", "greenhouse:asana",
  "greenhouse:cloudflare", "greenhouse:coinbase", "greenhouse:databricks", "greenhouse:doordashusa",
  "greenhouse:duolingo", "greenhouse:gusto", "greenhouse:lyft", "greenhouse:okta",
  "greenhouse:peloton", "greenhouse:reddit", "greenhouse:robinhood", "greenhouse:roblox",
  "greenhouse:samsara", "greenhouse:scaleai", "greenhouse:squarespace", "greenhouse:stripe",
  "greenhouse:toast", "greenhouse:waymo", "lever:aledade", "lever:shieldai", "lever:spotify",
  "lever:veeva", "lever:zoox", "smartrecruiters:expeditors", "smartrecruiters:socotec",
  "workable:esgusa", "workable:jacobian", "personio:ailylabs", "recruitee:natuvion",
  "recruitee:framestore", "jobicy:usa", "himalayas:usa", "weworkremotely:public",
  "remoteok:public", "remotive:public",
] as const;

const ConfigSchema = z.object({ sources: z.record(z.string(), z.object({ targets: z.array(TargetSchema) })) });
const SnapshotSchema = z.object({
  source: z.enum(SOURCE_IDS), tenant: z.string(), complete: z.literal(true),
  identities: z.array(z.never()).length(0),
}).strict();

export function trustedReadinessRunner(env: NodeJS.ProcessEnv) {
  return env.GITHUB_REPOSITORY === "varveta/applysmooth-data-fetch" &&
    env.GITHUB_REF === "refs/heads/main" && env.GITHUB_EVENT_NAME === "workflow_dispatch";
}

export function matchesAuditedConfiguration(config: unknown, activeJson: string) {
  try {
    const parsed = ConfigSchema.parse(config);
    const active = z.array(z.enum(SOURCE_IDS)).min(1).parse(JSON.parse(activeJson));
    if (new Set(active).size !== active.length) return false;
    const configured = active.flatMap(source => {
      const targets = parsed.sources[source]?.targets;
      if (!targets?.length || targets.some(target => target.source !== source)) throw new Error();
      return targets.map(target => `${source}:${target.tenant}`);
    });
    return configured.length === AUDITED_BOARDS.length && new Set(configured).size === configured.length &&
      configured.every(board => (AUDITED_BOARDS as readonly string[]).includes(board));
  } catch { return false; }
}

async function boundedSnapshot(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); }
}

/** Only empty-scope identity reads. Never restores checkpoints or invokes a writer. */
export async function runWriterReadiness(options: {
  config: unknown; activeSourcesJson: string;
  endpoint?: string; token?: string; bypass?: string;
  fetcher?: typeof fetch; wait?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
}) {
  const log = options.log ?? console.log;
  const report = {
    endpoint_matches_verified_TEST_alias: options.endpoint === VERIFIED_TEST_ENDPOINT,
    configuration_matches_audited_boards: matchesAuditedConfiguration(options.config, options.activeSourcesJson),
    credentials_present: typeof options.token === "string" && options.token.length >= 32,
    expected_boards: AUDITED_BOARDS.length, checked_boards: 0, passed_boards: 0, failed_boards: 0,
    success: false,
  };
  const finish = () => { log(JSON.stringify(report)); return report; };
  if (!report.endpoint_matches_verified_TEST_alias || !report.configuration_matches_audited_boards || !report.credentials_present)
    return finish();
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? sleep;
  const run_id = randomUUID(); // Required by the HTTP contract; this read never creates a run.
  for (const board of AUDITED_BOARDS) {
    if (report.checked_boards) await wait(1000);
    const [source, tenant] = board.split(":");
    let status: number | null = null;
    let valid = false;
    report.checked_boards++;
    try {
      const response = await fetcher(VERIFIED_TEST_ENDPOINT, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token}`,
          ...(options.bypass ? { "x-vercel-protection-bypass": options.bypass } : {}) },
        body: JSON.stringify({ operation: "board_identities", run_id, source, tenant, posting_ids: [] }),
      });
      status = response.status;
      if (response.status !== 200 || response.redirected || (response.url && response.url !== VERIFIED_TEST_ENDPOINT))
        await response.body?.cancel();
      else {
        const snapshot = SnapshotSchema.parse(await boundedSnapshot(response));
        valid = snapshot.source === source && snapshot.tenant === tenant;
      }
    } catch { /* Never log response content, exceptions, headers or credential values. */ }
    log(JSON.stringify({ board, http_status: status, valid_identity_response: valid,
      requested_identity_count: 0, returned_identity_count: valid ? 0 : null }));
    if (!valid) { report.failed_boards++; return finish(); } // No retries or further requests after a refusal.
    report.passed_boards++;
  }
  report.success = true;
  return finish();
}

async function main() {
  const runner_context_valid = trustedReadinessRunner(process.env);
  if (!runner_context_valid) {
    console.log(JSON.stringify({ runner_context_valid, success: false }));
    process.exitCode = 1;
    return;
  }
  const report = await runWriterReadiness({
    config: JSON.parse(readFileSync("ingest/config/sources.json", "utf8")),
    activeSourcesJson: process.env.COLLECTOR_ACTIVE_SOURCES ?? "[]",
    endpoint: process.env.COLLECTOR_ENDPOINT, token: process.env.COLLECTOR_TOKEN,
    bypass: process.env.COLLECTOR_VERCEL_BYPASS,
  });
  if (!report.success) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.log(JSON.stringify({ diagnostic_completed: false, success: false })); process.exitCode = 1; });
