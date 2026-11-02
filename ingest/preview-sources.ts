import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type CatalogRow, WORK_MODES, JOB_TYPES } from "../src/lib/jobs-ingest/contract";
import { validateTargets } from "./validate-targets";

const terms = z.array(z.string().trim().min(1).max(120)).max(100).default([]);
export const PreviewFilters = z.object({
  title_any: terms, exclude_any: terms, description_any: terms,
  work_modes: z.array(z.enum(WORK_MODES)).default([]),
  job_types: z.array(z.enum(JOB_TYPES)).default([]),
}).strict();
export function matchesFilters(row: CatalogRow, filters: z.infer<typeof PreviewFilters>) {
  const title = row.title.toLowerCase(), description = row.description.toLowerCase();
  const any = (values: string[], value: string) => !values.length || values.some(v => value.includes(v.toLowerCase()));
  return any(filters.title_any, title) && any(filters.description_any, description) &&
    !filters.exclude_any.some(v => `${title}\n${description}`.includes(v.toLowerCase())) &&
    (!filters.work_modes.length || (row.work_mode !== null && filters.work_modes.includes(row.work_mode))) &&
    (!filters.job_types.length || (row.job_type !== null && filters.job_types.includes(row.job_type)));
}
export async function previewSources(manifest: unknown, config: unknown, options: Parameters<typeof validateTargets>[1] = {}) {
  const filters = PreviewFilters.parse(config); // Fail invalid filters before fetching.
  const accepted: CatalogRow[] = [];
  const report = await validateTargets(manifest, { ...options, onAccepted: rows => accepted.push(...rows) });
  const selected = accepted.filter(row => matchesFilters(row, filters));
  return { accepted, selected, report: { ...report, accepted_count: accepted.length, selected_count: selected.length,
    filters, cross_source_deduplication: false, output_use: "local-review-only" } };
}
async function main() {
  const [manifestPath, filtersPath] = process.argv.slice(2);
  if (!manifestPath || !filtersPath || process.argv.length !== 4)
    throw new Error("Usage: pnpm preview:sources <manifest.json> <filters.json>");
  const result = await previewSources(JSON.parse(readFileSync(manifestPath, "utf8")), JSON.parse(readFileSync(filtersPath, "utf8")));
  const directory = "ingest/data/preview";
  mkdirSync(directory, { recursive: true });
  // Replace each snapshot, including empty/failed runs; never retain stale prior success.
  for (const [name, rows] of [["accepted", result.accepted], ["selected", result.selected]] as const)
    writeFileSync(`${directory}/${name}.jsonl`, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), { mode: 0o600 });
  writeFileSync(`${directory}/report.json`, JSON.stringify(result.report, null, 2) + "\n");
  console.log(JSON.stringify(result.report));
  process.exitCode = result.report.success ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : "Preview failed"); process.exitCode = 1; });
