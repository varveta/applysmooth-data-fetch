import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SOURCE_IDS } from "@/lib/jobs-ingest/contract";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { evaluateGates, type GateReason } from "@/lib/jobs-ingest/gates";
import { loadBoard } from "./lib/load-board";
import { getJson } from "./lib/http";
import { safeReason } from "./lib/diagnostics";
import { prepareBoard, TargetSchema } from "./stateless";

const ManifestSchema = z.object({ targets: z.array(TargetSchema).min(1).max(500) });
type ValidationOptions = { get?: typeof getJson; now?: Date; source?: string };
type BoardReport = {
  board: string;
  company: string;
  success: boolean;
  fetched_count: number | null;
  accepted_count: number | null;
  rejected_count: number | null;
  quarantined_count: number | null;
  reason_counts: Partial<Record<GateReason, number>>;
  requests: number;
  bytes: number;
  duration_ms: number;
  writes: 0;
  error?: string;
  discovery?: unknown;
};

/** Fetch/normalize only. No collector client, credentials, activation or database access. */
export async function validateTargets(manifest: unknown, options: ValidationOptions = {}) {
  let { targets } = ManifestSchema.parse(manifest);
  if (new Set(targets.map((target) => `${target.source}:${target.tenant}`)).size !== targets.length)
    throw new Error("Duplicate source/tenant in validation manifest");
  if (options.source !== undefined) {
    const source = z.enum(SOURCE_IDS).parse(options.source);
    targets = targets.filter((target) => target.source === source);
    if (!targets.length) throw new Error("Source is absent from validation manifest");
  }
  const now = options.now ?? new Date();
  const started = Date.now();
  const boards: BoardReport[] = [];
  for (const target of targets) {
    const boardStarted = Date.now();
    const report: BoardReport = { board: `${target.source}:${target.tenant}`, company: target.company,
      success: false, fetched_count: null, accepted_count: null, rejected_count: null,
      quarantined_count: null, reason_counts: {}, requests: 0, bytes: 0, duration_ms: 0, writes: 0 };
    // Count the work even if a later page fails and loadBoard never returns.
    const get: typeof getJson = async (url, opts) => {
      let response;
      try { response = await (options.get ?? getJson)(url, opts); }
      catch (error) { report.requests++; throw error; }
      report.requests += response.attempts;
      if (response.ok) report.bytes += response.bytes;
      return response;
    };
    try {
      const fetched = await loadBoard(target, get);
      const prepared = prepareBoard(target, fetched.body, now, {
        source: target.source, tenant: target.tenant, complete: true, identities: [],
      });
      // Reasons describe quality gates before cross-posting deduplication. Several
      // reasons can apply to one job; these counts must not be summed as jobs.
      const adapter = ADAPTERS[target.source];
      const seen = new Set<string>();
      for (const raw of adapter.parseListing(fetched.body)) {
        const job = adapter.normalize(raw, target.tenant, target.company);
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        const gate = evaluateGates(job, { now, open: true, lastSeenAt: now.toISOString(), duplicateOf: null });
        for (const reason of gate.reasons)
          report.reason_counts[reason] = (report.reason_counts[reason] ?? 0) + 1;
      }
      report.success = true;
      report.fetched_count = prepared.fetched_count;
      report.accepted_count = prepared.rows.length;
      report.rejected_count = prepared.gates.rejected ?? 0;
      report.quarantined_count = prepared.gates.quarantined ?? 0;
      if ("discovery" in fetched) report.discovery = fetched.discovery;
    } catch (error) { report.error = safeReason(error); }
    report.duration_ms = Date.now() - boardStarted;
    boards.push(report);
  }
  return { mode: "read-only-validation" as const, success: boards.every((board) => board.success),
    started_at: now.toISOString(), duration_ms: Date.now() - started, writes: 0 as const,
    identity_basis: "empty_snapshot" as const, live_ingestion_verified: false as const,
    reason_count_basis: "pre_deduplication_quality_gates; reasons may overlap" as const,
    boards };
}

export async function runValidation(manifestPath: string, options: ValidationOptions & { outputDirectory?: string } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const report = await validateTargets(manifest, options);
  const outputDirectory = options.outputDirectory ?? "ingest/data";
  mkdirSync(outputDirectory, { recursive: true });
  const reportPath = join(outputDirectory, `source-validation-test${options.source ? `-${options.source}` : ""}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  return { report, reportPath, exitCode: report.success ? 0 : 1 };
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath || process.argv.length < 3 || process.argv.length > 4)
    throw new Error("Usage: tsx ingest/validate-targets.ts <manifest.json> [source]");
  const result = await runValidation(manifestPath, { source: process.argv[3] });
  console.log(JSON.stringify(result.report));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## TEST source validation\n\nResult: **${result.report.success ? "passed" : "failed"}** · Boards: ${result.report.boards.length} · Database writes: **0**\n\nCounts use empty identity snapshots. This verifies fetching and local preparation, not live ingestion. See the JSON artifact for per-board results and overlapping gate reasons.\n`);
  process.exitCode = result.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(JSON.stringify({ success: false, writes: 0, error: safeReason(error) })); process.exitCode = 1; });
