import { expect, it, vi } from "vitest";
import { loadGetworkBoard } from "../../../ingest/lib/fetch-getwork";
import { evaluateGates } from "./gates";
import { GetworkPosting, getwork } from "./getwork";

const raw = (id = "gh-example-123") => ({
  id, title: "Platform Engineer", company: { name: "Example Employer", slug: "example", claimed: true },
  getwork_url: `https://getwork.dev/jobs/${id}/`, url: `https://careers.example.com/jobs/${id}`,
  apply_url: `https://careers.example.com/jobs/${id}?from=provider#apply`,
  published_at: "2026-10-29T08:41:42Z", first_seen_at: "2026-11-01T12:00:00Z", last_seen_at: "2026-11-02T12:00:00Z",
  location: "Boston, MA", countries: ["US"], regions: ["north_america"],
  remote: "hybrid", employment_type: "full-time", active: true,
  untrusted_description: "Responsibilities\n" + "Build reliable distributed services. ".repeat(12) + "\nOriginal final requirement.",
  candidate_actions: { endpoint: "https://invalid.example/action" },
});
const ok = (body: unknown) => ({ ok: true as const, body, status: 200, attempts: 1, bytes: 100 });
const page = (jobs: unknown[], total = jobs.length) => ({ jobs, total });
const noWait = async () => {};

it("preserves full plain text, original publication time, employer and attribution links", () => {
  const j = getwork.normalize(raw(), "public", "Ignored display label");
  expect(j).toMatchObject({ source: "getwork", sourceJobId: "gh-example-123", company: "Example Employer",
    usEligibility: "us", postedAt: "2026-10-29T08:41:42.000Z", sourceUpdatedAt: null,
    sourceUrl: raw().getwork_url, applyUrl: raw().apply_url, workMode: "Hybrid", jobType: "Full-time" });
  expect(j.descriptionText).toBe(raw().untrusted_description);
  expect(getwork.attribution("public", j)).toEqual({ name: "getwork.dev", url: raw().getwork_url });
  expect(() => getwork.attribution("public")).toThrow("per-job");
  expect(GetworkPosting.parse(raw())).not.toHaveProperty("candidate_actions");
  expect(GetworkPosting.parse(raw()).company).not.toHaveProperty("claimed");
});

it("does not turn broad regions, remote status or US employer/client prose into US eligibility", () => {
  const unknown = { ...raw(), countries: [], location: "Remote", remote: "remote",
    untrusted_description: raw().untrusted_description + "\nWe serve United States clients." };
  expect(getwork.normalize(unknown, "public").usEligibility).toBe("unknown");
  expect(getwork.normalize({ ...unknown, countries: ["CA"] }, "public").usEligibility).toBe("not_us");
  // The explicit country field takes priority over an ambiguous city/state-style string.
  expect(getwork.normalize({ ...raw(), countries: ["CA"] }, "public").usEligibility).toBe("not_us");
  expect(getwork.normalize({ ...unknown, countries: ["CA", "US"] }, "public").usEligibility).toBe("us");
});

it("keeps unknown original dates unknown and never substitutes first/last seen timestamps", () => {
  const j = getwork.normalize({ ...raw(), published_at: null, apply_url: null }, "public");
  expect(j.postedAt).toBeNull();
  expect(j.sourceUpdatedAt).toBeNull();
  expect(j.applyUrl).toBe(raw().url);
  expect(() => getwork.normalize({ ...raw(), published_at: "yesterday" }, "public")).toThrow();
});

it("keeps oversized full text for quality-gate rejection without clipping", () => {
  const j = getwork.normalize({ ...raw(), untrusted_description: "x".repeat(50_001) }, "public");
  expect(j.descriptionText).toHaveLength(50_001);
  expect(evaluateGates(j, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z", open: true, duplicateOf: null }).reasons)
    .toContain("description_too_long");
});

it("rejects unsafe source/apply URLs, invalid tenants and inactive jobs", () => {
  for (const url of ["https://evil.example/jobs/gh-example-123/", "https://getwork.dev/jobs/other/",
    "https://getwork.dev/jobs/gh-example-123/?redirect=elsewhere", "https://getwork.dev/jobs/gh-example-123/#apply"])
    expect(() => getwork.normalize({ ...raw(), getwork_url: url }, "public")).toThrow();
  for (const url of ["http://careers.example.com/jobs/1", "https://127.0.0.1/jobs/1", "https://user@careers.example.com/jobs/1",
    "https://careers.example.com:444/jobs/1", "https://jobs.internal/jobs/1", "https://localhost/jobs/1"])
    expect(() => getwork.normalize({ ...raw(), apply_url: url }, "public")).toThrow();
  expect(() => getwork.normalize({ ...raw(), active: false }, "public")).toThrow("Inactive");
  expect(() => getwork.normalize(raw(), "other")).toThrow();
});

it("loads a paced, capped observation window and fetches details on the provider host only", async () => {
  const jobs = [raw("gh-example-1"), raw("gh-example-2")];
  const wait = vi.fn(noWait);
  const get = vi.fn(async (url: string) => ok(url.includes("?") ? page(jobs, 100) : jobs.find(j => url.endsWith(`/${j.id}/`))));
  const result = await loadGetworkBoard({ tenant: "public" }, get, { maxJobs: 2, wait });
  expect(result.body).toHaveLength(2);
  expect(result.discovery).toEqual({ policy: "observations", pages: 3, capped: true, maximum_jobs: 2 });
  expect(wait).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledWith(1000);
  expect(get).toHaveBeenNthCalledWith(1, "https://getwork.dev/api/jobs?country=US&days=15&limit=2&offset=0",
    { attempts: 2, timeoutMs: 20_000, maxBytes: 2_000_000, baseDelayMs: 1000, redirect: "error" });
  expect(get.mock.calls.every(([url]) => new URL(url).origin === "https://getwork.dev")).toBe(true);
  const empty = await loadGetworkBoard({ tenant: "public" }, async () => ok(page([])), { wait: noWait });
  expect(empty.body).toEqual([]);
  expect(empty.discovery.capped).toBe(false);
});

it("rejects incomplete windows, duplicate IDs and budgets above the maximum", async () => {
  await expect(loadGetworkBoard({ tenant: "public" }, async () => ok(page([raw()], 100)), { wait: noWait })).rejects.toThrow("Incomplete");
  await expect(loadGetworkBoard({ tenant: "public" }, async () => ok(page([raw(), raw()])), { wait: noWait })).rejects.toThrow("Duplicate");
  const get = vi.fn(async () => ok(page([])));
  await expect(loadGetworkBoard({ tenant: "public" }, get, { maxJobs: 51, wait: noWait })).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});

it("aborts failed, changed, incomplete or inactive detail responses without returning partial results", async () => {
  for (const scenario of ["failure", "id", "company", "date", "truncated", "inactive"] as const) {
    let calls = 0;
    await expect(loadGetworkBoard({ tenant: "public" }, async () => {
      if (++calls === 1) return ok(page([raw()]));
      if (scenario === "failure") return { ok: false, status: 503, error: "HTTP 503", attempts: 2, retryable: true };
      if (scenario === "id") return ok(raw("gh-example-other"));
      if (scenario === "company") return ok({ ...raw(), company: { name: "Another Employer", slug: "other" } });
      if (scenario === "date") return ok({ ...raw(), published_at: "2026-11-02T12:00:00Z" });
      if (scenario === "inactive") return ok({ ...raw(), active: false });
      return ok({ id: raw().id });
    }, { wait: noWait })).rejects.toThrow();
  }
});
