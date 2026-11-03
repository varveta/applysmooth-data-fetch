import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { previewSources } from "./preview-sources";
import { refilterPreview } from "./refilter-preview";
import { ashbyFixture } from "./synthetic-fixtures";
it("refilters cached full records without fetching and clears a prior selection on zero matches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "refilter-preview-"));
  try {
    const result = await previewSources({ targets: [{ source: "ashby", tenant: "example", company: "Example" }] }, {}, {
      now: new Date("2026-10-30T12:00:00Z"),
      get: async () => ({ ok: true, status: 200, body: { jobs: [ashbyFixture] }, bytes: 100, attempts: 1 }),
    });
    expect(result.accepted).toHaveLength(1);
    writeFileSync(join(dir, "accepted.jsonl"), result.accepted.map(j => JSON.stringify(j)).join("\n"));
    const config = join(dir, "filters.json");
    writeFileSync(config, '{}');
    expect(refilterPreview(config, dir)).toMatchObject({ selected_count: 1, requests: 0, database_writes: 0, freshness_rechecked: false });
    writeFileSync(config, JSON.stringify({ title_any: ["unmatched role"] }));
    expect(refilterPreview(config, dir).selected_count).toBe(0);
    expect(readFileSync(join(dir, "selected.jsonl"), "utf8")).toBe("");
    expect(readFileSync(join(dir, "accepted.jsonl"), "utf8")).toContain(ashbyFixture.title);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
