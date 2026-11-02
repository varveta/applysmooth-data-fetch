import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  EXPERIMENTAL_SOURCE_IDS,
  type CatalogRow,
} from "@/lib/jobs-ingest/contract";
import { validateTargets } from "./validate-targets";
import { verifier } from "./verify";
import { pool } from "./lib/http";
import { safeReason } from "./lib/diagnostics";

/** No collector client, database access, secrets or application submissions. */
export async function verifyPreview(
  manifest: unknown,
  options: {
    source: string;
    validate?: typeof validateTargets;
    checker?: ReturnType<typeof verifier>;
  },
) {
  const source = z.enum(EXPERIMENTAL_SOURCE_IDS).parse(options.source);
  const rows: CatalogRow[] = [];
  const validation = await (options.validate ?? validateTargets)(manifest, {
    source,
    onAccepted: (accepted) => rows.push(...accepted),
  });
  const checker =
    options.checker ??
    verifier({ allowExperimental: true, concurrency: 3, perHost: 2 });
  const results: { board: string; stage: string; status: string; detail: string }[] = [];
  const failures = await pool(
    rows,
    (row) => `${row.source}:${row.source_tenant}`,
    3,
    2,
    async (row) => {
      const result = await checker.check({
        id: row.id,
        source: row.source,
        tenant: row.source_tenant,
        source_job_id: row.source_job_id,
        apply_url: row.apply_url,
        reason: "read_only_preview",
      });
      results.push({
        board: `${row.source}:${row.source_tenant}`,
        stage: result.stage,
        status: result.status,
        detail: result.detail,
      });
    },
  );
  for (const { item: row } of failures)
    results.push({
      board: `${row.source}:${row.source_tenant}`,
      stage: "verify",
      status: "uncertain",
      detail: "Verification threw",
    });
  const boards = validation.boards.map((board) => {
    const checked = results.filter((r) => r.board === board.board);
    const outcomes: Record<string, number> = {};
    const reason_counts: Record<string, number> = {};
    for (const r of checked) {
      outcomes[r.status] = (outcomes[r.status] ?? 0) + 1;
      const reason = `${r.stage}: ${r.status}: ${r.detail}`;
      reason_counts[reason] = (reason_counts[reason] ?? 0) + 1;
    }
    return {
      board: board.board,
      fetch_success: board.success,
      accepted: board.accepted_count,
      checked: checked.length,
      outcomes,
      reason_counts,
      unverified: !checked.length,
    };
  });
  return {
    mode: "read-only-source-and-link-verification",
    source,
    started_at: validation.started_at,
    validation,
    writes: 0,
    production_ready: false,
    success:
      validation.success &&
      rows.length > 0 &&
      results.every((r) => r.status === "open"),
    fetch_requests: validation.boards.reduce((n, b) => n + b.requests, 0),
    verification_requests: checker.metrics.requests,
    boards,
  };
}
async function main() {
  const [manifest, source] = process.argv.slice(2);
  if (!manifest || !source || process.argv.length !== 4)
    throw new Error(
      "Usage: tsx ingest/verify-preview.ts <manifest.json> <source>",
    );
  const report = await verifyPreview(
    JSON.parse(readFileSync(manifest, "utf8")),
    { source },
  );
  mkdirSync("ingest/data", { recursive: true });
  writeFileSync(
    `ingest/data/source-validation-test-${report.source}.json`,
    JSON.stringify(report.validation, null, 2) + "\n",
  );
  writeFileSync(
    `ingest/data/source-verification-test-${report.source}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  process.exitCode = report.success ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      JSON.stringify({ success: false, writes: 0, error: safeReason(error) }),
    );
    process.exitCode = 1;
  });
