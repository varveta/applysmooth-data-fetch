import { expect, it, vi } from "vitest";
import { loadRemotefirstjobsBoard } from "../../../ingest/lib/fetch-remotefirstjobs";
import { evaluateGates } from "./gates";
import { ADAPTERS } from "./adapters";
import { isExperimentalSource } from "./contract";
import { remotefirstjobs } from "./remotefirstjobs";

const raw = (id = "platform-engineer-123") => ({
  id, url: `https://remotefirstjobs.com/companies/example-employer/jobs/${id}`,
  title: "Platform Engineer", company_name: "Example Employer", locations: ["United States"],
  category: "software_development", published_at: "2026-11-01T05:24:11",
  description: "<h2>Responsibilities</h2><p>" + "Build reliable distributed services. ".repeat(12) +
    "</p><h2>Benefits</h2><p>Health &amp; dental.</p><p>Original final requirement.</p>",
});
const ok = (body: unknown) => ({ ok: true as const, status: 200, body, attempts: 1, bytes: 100 });
const page = (jobs: unknown[], index = 0) => ({ page: index, jobs_count: jobs.length, jobs });
const noWait = async () => {};

it("preserves all description sections, actual employer and provider application/credit", () => {
  const job = remotefirstjobs.normalize(raw(), "public", "Ignored label");
  expect(job).toMatchObject({ source: "remotefirstjobs", sourceJobId: raw().id,
    company: "Example Employer", usEligibility: "us", workMode: "Remote",
    sourceUrl: raw().url, applyUrl: raw().url, postedAt: null, sourceUpdatedAt: null });
  expect(job.descriptionText).toContain("Responsibilities");
  expect(job.descriptionText).toMatch(/Benefits\s+Health & dental\./);
  expect(job.descriptionText).toMatch(/Original final requirement\.$/);
  expect(remotefirstjobs.attribution("public", job)).toEqual({ name: "Remote First Jobs", url: raw().url });
  expect(() => remotefirstjobs.attribution("public")).toThrow("per-job");
});

it("never fabricates original freshness from provider publication or updated values", () => {
  for (const published_at of [null, "2026-11-01T05:24:11", "2026-11-01T05:24:11Z", "2026-11-01T05:24:11+02:00"]) {
    const job = remotefirstjobs.normalize({ ...raw(), published_at, updated_at: "2026-11-02T12:00:00Z" }, "public");
    expect(job.postedAt).toBeNull(); expect(job.sourceUpdatedAt).toBeNull();
  }
  expect(() => remotefirstjobs.normalize({ ...raw(), published_at: "yesterday" }, "public")).toThrow();
});

it("requires explicit US country eligibility, not generic remote, region or company prose", () => {
  for (const locations of [[], [""], ["Worldwide"], ["North America"], ["Remote"], ["US clients"]]) {
    const job = remotefirstjobs.normalize({ ...raw(), locations,
      description: raw().description + "<p>Our US clients operate in the United States.</p>" }, "public");
    expect(job.usEligibility).toBe("unknown");
  }
  expect(remotefirstjobs.normalize({ ...raw(), locations: ["Canada"] }, "public").usEligibility).toBe("not_us");
  expect(remotefirstjobs.normalize({ ...raw(), locations: ["Canada", "United States"] }, "public").usEligibility).toBe("us");
});

it("rejects malformed identity/URLs, unsafe tenants and duplicate normalized input", () => {
  for (const url of [raw().url + "/", raw().url + "\n", raw().url + "?ref=x", raw().url + "#apply",
    raw().url.replace(".com", ".com:443"), raw().url.replace("https://", "https://user@"),
    raw().url.replace("remotefirstjobs.com", "evil.example"), raw().url.replace(raw().id, "other-999"),
    raw().url.replace("/jobs/", "/jobs/%2e%2e/")])
    expect(() => remotefirstjobs.normalize({ ...raw(), url }, "public")).toThrow();
  expect(() => remotefirstjobs.normalize(raw("../123"), "public")).toThrow();
  expect(() => remotefirstjobs.normalize(raw("platform-engineer-123\n"), "public")).toThrow();
  expect(() => ADAPTERS.remotefirstjobs.postingId(raw("a".repeat(120) + "-123"))).toThrow();
  expect(isExperimentalSource("remotefirstjobs")).toBe(true);
  expect(() => ADAPTERS.remotefirstjobs.parseListing([{ ...raw(), url: raw().url + "?tracking=x" }])).toThrow();
  expect(() => remotefirstjobs.normalize(raw(), "other")).toThrow();
  expect(() => remotefirstjobs.parseListing([raw(), raw()])).toThrow("Duplicate");
  expect(() => remotefirstjobs.parseListing([{ ...raw(), description: undefined }])).toThrow();
});

it("preserves oversized descriptions so the existing quality gate rejects without clipping", () => {
  const job = remotefirstjobs.normalize({ ...raw(), description: `<p>${"x".repeat(50_001)}</p>` }, "public");
  expect(job.descriptionText).toHaveLength(50_001);
  expect(evaluateGates(job, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z",
    open: true, duplicateOf: null }).reasons).toContain("description_too_long");
});

it("loads only a capped observation window using safe bounded HTTP requests", async () => {
  const jobs = Array.from({ length: 100 }, (_, i) => raw(`platform-engineer-${i + 1}`));
  const get = vi.fn(async () => ok(page(jobs)));
  const result = await loadRemotefirstjobsBoard({ tenant: "public" }, get);
  expect(result.body).toHaveLength(100);
  expect(result.discovery).toEqual({ policy: "observations", pages: 1, capped: true,
    maximum_jobs: 100, publication_dates: "unknown_original_provenance" });
  expect(get).toHaveBeenCalledExactlyOnceWith(
    "https://remotefirstjobs.com/api/search-jobs?category=software-development&page=0",
    { attempts: 2, timeoutMs: 20_000, maxBytes: 4_000_000, baseDelayMs: 1000, redirect: "error" });
});

it("paces bounded pagination and keeps the same filters without detail requests", async () => {
  const wait = vi.fn(noWait);
  const first = Array.from({ length: 100 }, (_, i) => raw(`platform-engineer-${i + 1}`));
  const get = vi.fn(async (url: string) => ok(page(url.endsWith("=0") ? first : [raw("platform-engineer-101")], url.endsWith("=0") ? 0 : 1)));
  const result = await loadRemotefirstjobsBoard({ tenant: "public" }, get, { maxPages: 5, wait });
  expect(result.body).toHaveLength(101); expect(result.discovery).toMatchObject({ pages: 2, capped: false, maximum_jobs: 500 });
  expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
  expect(get.mock.calls.map(([url]) => url)).toEqual([0, 1].map(n => `https://remotefirstjobs.com/api/search-jobs?category=software-development&page=${n}`));
  const empty = await loadRemotefirstjobsBoard({ tenant: "public" }, async () => ok(page([])), { wait: noWait });
  expect(empty.body).toEqual([]); expect(empty.discovery.capped).toBe(false);
});

it("fails count/page/duplicate inconsistencies and never returns partial paginated failures", async () => {
  const first = Array.from({ length: 100 }, (_, i) => raw(`platform-engineer-${i + 1}`));
  for (const response of [ok({ ...page([raw()]), jobs_count: 2 }), ok(page([raw()], 1)), ok(page([raw(), raw()])),
    { ok: false as const, status: 403, error: "HTTP 403", attempts: 1, retryable: false }, { ...ok(page([])), status: 201 }])
    await expect(loadRemotefirstjobsBoard({ tenant: "public" }, async () => response)).rejects.toThrow();
  for (const response of [ok(page([first[0]], 1)), { ok: false as const, status: 503, error: "HTTP 503", attempts: 2, retryable: true }]) {
    let calls = 0;
    await expect(loadRemotefirstjobsBoard({ tenant: "public" }, async () => ++calls === 1 ? ok(page(first)) : response,
      { maxPages: 2, wait: noWait })).rejects.toThrow();
    expect(calls).toBe(2);
  }
});

it("validates tenant and page budgets before networking", async () => {
  const get = vi.fn(async () => ok(page([])));
  for (const maxPages of [0, 6, 1.5])
    await expect(loadRemotefirstjobsBoard({ tenant: "public" }, get, { maxPages })).rejects.toThrow();
  await expect(loadRemotefirstjobsBoard({ tenant: "other" }, get)).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
