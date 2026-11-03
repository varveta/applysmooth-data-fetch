import { expect, it, vi } from "vitest";
import { breezy } from "./breezy";
import { loadBreezyBoard } from "../../../ingest/lib/fetch-breezy";
import { previewSources, PreviewFilters, matchesFilters } from "../../../ingest/preview-sources";
import { resolveMode } from "../../../ingest/source-pipeline";
import { runStateless } from "../../../ingest/stateless";
import type { FetchResult } from "../../../ingest/lib/http";
const raw = { id: "abc123", name: "Data Engineer", url: "https://example.breezy.hr/p/abc123-data-engineer",
  published_date: "2026-10-25T00:00:00Z", type: { name: "Full-Time" },
  location: { city: "Austin", state: { name: "Texas" }, country: { id: "US", name: "United States" }, is_remote: true } };
const target = { source: "breezy" as const, tenant: "example", company: "Example" };
const description = "Build reliable SQL data pipelines and maintain PostgreSQL services. ".repeat(90);
const ld = { "@type": "JobPosting", url: raw.url + "?source=GoogleJobs", description,
  datePosted: "2026-10-24", validThrough: "2026-11-30" };
const html = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const ok = (body: unknown): FetchResult => ({ ok: true, status: 200, body, attempts: 1, bytes: 100 });
const now = new Date("2026-10-31T12:00:00Z");
it("fetches full details, preserves source dates and applies existing gates plus configurable filters", async () => {
  const get = vi.fn(async (url: string) => ok(url.endsWith("/json") ? [raw] : html(ld)));
  const result = await previewSources({ targets: [target] }, { title_any: ["engineer"], description_any: ["SQL"], work_modes: ["Remote"] }, { now, get });
  expect(result.report).toMatchObject({ success: true, writes: 0, accepted_count: 1, selected_count: 1 });
  expect(result.selected[0]).toMatchObject({ company: "Example", posted_at: "2026-10-24T00:00:00.000Z", work_mode: "Remote" });
  expect(result.selected[0].description.length).toBeGreaterThan(4000);
  expect(result.report.boards[0]).toMatchObject({ requests: 2, discovery: { policy: "observations" } });
  expect(matchesFilters(result.selected[0], PreviewFilters.parse({ exclude_any: ["PostgreSQL"] }))).toBe(false);
  expect(matchesFilters({ ...result.selected[0], work_mode: null }, PreviewFilters.parse({ work_modes: ["Remote"] }))).toBe(false);
});
it("does not publish partial boards or treat detail errors as empty success", async () => {
  const result = await previewSources({ targets: [target] }, {}, { now, get: async url => url.endsWith("/json") ? ok([raw]) :
    { ok: false, status: 403, attempts: 1, error: "HTTP 403", retryable: false } });
  expect(result.report.success).toBe(false);
  expect(result.accepted).toEqual([]);
  expect(result.report.boards[0].fetched_count).toBeNull();
});
it("rejects malformed lists, duplicate IDs and off-board URLs before detail requests", async () => {
  for (const body of [{ error: "blocked" }, [raw, raw], [{ ...raw, url: "https://attacker.example/p/abc123" }]]) {
    const get = vi.fn(async () => ok(body));
    await expect(loadBreezyBoard(target, get)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  }
});
it("requires matching full job details instead of accepting unrelated JSON-LD", async () => {
  for (const value of [{ "@type": "WebSite" }, { ...ld, url: "https://example.breezy.hr/p/other" }, [ld, ld]])
    await expect(loadBreezyBoard(target, async url => ok(url.endsWith("/json") ? [raw] : html(value)))).rejects.toThrow();
});
it("retains future/expired dates for gates and does not infer US from remote", async () => {
  const result = await previewSources({ targets: [target] }, {}, { now, get: async url => ok(url.endsWith("/json") ? [raw] : html({ ...ld, validThrough: "2026-10-01" })) });
  expect(result.report.boards[0]).toMatchObject({ rejected_count: 1, reason_counts: { closed_at_source: 1 } });
  expect(breezy.normalize({ ...raw, location: { name: "Remote", is_remote: true } }, "example", "Example").usEligibility).toBe("unknown");
});
it("rejects invalid filters before networking and blocks live publishing", async () => {
  const get = vi.fn(async () => ok([]));
  await expect(previewSources({ targets: [target] }, { unknown_filter: true }, { get })).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
  expect(() => resolveMode("breezy", "publish", '["breezy"]')).toThrow(/TEST-only/);
  const call = vi.fn(async () => ({}));
  await expect(runStateless({ targets: [target], client: { metrics: { requests: 0, payload_bytes: 0 }, call } })).rejects.toThrow(/TEST-only/);
  expect(call).not.toHaveBeenCalled();
});

it("reads full older HTML templates only with matching canonical and apply links", async () => {
  const page = `<link rel="canonical" href="${raw.url}"><a href="${raw.url}/apply">Apply</a><div class="description"><p>${description}</p><div>Nested responsibilities</div></div>`;
  const result = await loadBreezyBoard(target, async url => ok(url.endsWith("/json") ? [raw] : page));
  expect(breezy.normalize(result.body[0], target.tenant, target.company).descriptionText).toContain("Nested responsibilities");
  for (const broken of [page.replace(raw.url + '/apply', '/login'), page.replace('rel="canonical"', 'rel="other"'), page + '<div class="description">Other job</div>'])
    await expect(loadBreezyBoard(target, async url => ok(url.endsWith("/json") ? [raw] : broken))).rejects.toThrow();
});
