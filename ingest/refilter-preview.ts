import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CatalogRowSchema } from "../src/lib/jobs-ingest/contract";
import { PreviewFilters, matchesFilters } from "./preview-sources";

/** Reapply preferences to an existing local snapshot; no HTTP or database calls. */
export function refilterPreview(filtersPath: string, directory = "ingest/data/preview") {
  const filters = PreviewFilters.parse(JSON.parse(readFileSync(filtersPath, "utf8")));
  const rows = readFileSync(`${directory}/accepted.jsonl`, "utf8").split("\n").filter(Boolean)
    .map(line => CatalogRowSchema.parse(JSON.parse(line)));
  const selected = rows.filter(row => matchesFilters(row, filters));
  writeFileSync(`${directory}/selected.jsonl`, selected.map(row => JSON.stringify(row)).join("\n") + (selected.length ? "\n" : ""), { mode: 0o600 });
  const report = { mode: "offline-refilter", accepted_count: rows.length, selected_count: selected.length,
    filters, requests: 0, database_writes: 0, freshness_rechecked: false };
  writeFileSync(`${directory}/selection-report.json`, JSON.stringify(report, null, 2) + "\n");
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: pnpm refilter:sources <filters.json>");
  console.log(JSON.stringify(refilterPreview(process.argv[2])));
}
