import { expect, it, vi } from "vitest";
import { getonboard, GetonboardPosting } from "./getonboard";
import { loadGetonboardBoard } from "../../../ingest/lib/fetch-getonboard";
import { evaluateGates } from "./gates";

const raw = (id = "test-job") => ({
  id, type: "job",
  attributes: {
    title: "Platform Engineer", description_headline: "The role",
    description: "<p>" + "Build reliable distributed services. ".repeat(12) + "</p>",
    projects: "<p>Original project scope.</p>", functions_headline: "Responsibilities",
    functions: "<p>Original responsibilities.</p>", benefits_headline: "Benefits",
    benefits: "<p>Original benefits.</p>", desirable_headline: "Preferred",
    desirable: "<p>Original preferences.</p>", countries: ["United States"],
    remote: false, remote_modality: "hybrid", published_at: 1793491200,
    company: { data: { id: "example", type: "company", attributes: {
      name: "Example Employer", country: "US", long_description: "Unrelated company profile",
    } } },
    applications_count: 99,
  },
  links: { public_url: `https://www.getonbrd.com/jobs/${id}` },
});
const ok = (body: unknown) => ({ ok: true as const, body, status: 200, attempts: 1, bytes: 100 });
const page = (jobs: unknown[], number = 1, total = 1) => ({ data: jobs, meta: { page: number, per_page: 10, total_pages: total } });
const noWait = async () => {};

it("preserves the employer, full description sections, original date, and provider links", () => {
  const j = getonboard.normalize(raw(), "public", "Ignored display label");
  expect(j).toMatchObject({ source: "getonboard", sourceJobId: "test-job", company: "Example Employer",
    usEligibility: "us", workMode: "Hybrid", postedAt: "2026-11-01T00:00:00.000Z",
    sourceUrl: "https://www.getonbrd.com/jobs/test-job", applyUrl: "https://www.getonbrd.com/jobs/test-job" });
  for (const phrase of ["Original project scope.", "Original responsibilities.", "Original benefits.", "Original preferences."])
    expect(j.descriptionText).toContain(phrase);
  expect(j.descriptionText).not.toContain("Unrelated company profile");
  expect(getonboard.attribution("public", j)).toEqual({ name: "Get on Board", url: j.sourceUrl });
  const parsed = GetonboardPosting.parse(raw());
  expect(parsed.attributes).not.toHaveProperty("applications_count");
  expect(parsed.attributes.company.data.attributes).not.toHaveProperty("long_description");
});
it("does not infer US access from a US employer, clients, remote status, or the query", () => {
  const value = raw();
  value.attributes.countries = ["Remote"];
  value.attributes.remote = true;
  value.attributes.remote_modality = "remote_local";
  value.attributes.description += "<p>We support United States customers from Latin America.</p>";
  expect(getonboard.normalize(value, "public").usEligibility).toBe("unknown");
  value.attributes.countries = ["Chile"];
  expect(getonboard.normalize(value, "public").usEligibility).toBe("not_us");
  value.attributes.countries = ["United States", "Canada"];
  expect(getonboard.normalize(value, "public").usEligibility).toBe("us");
});
it("preserves unknown dates and lets quality gates reject excessive content without truncating", () => {
  const value = { ...raw(), attributes: { ...raw().attributes, published_at: null, description: "x".repeat(50_001) } };
  const j = getonboard.normalize(value, "public");
  expect(j.postedAt).toBeNull();
  expect(j.descriptionText.length).toBeGreaterThan(50_000);
  expect(evaluateGates(j, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z", open: true, duplicateOf: null }).reasons)
    .toContain("description_too_long");
});
it("loads complete search pages at a bounded pace", async () => {
  const wait = vi.fn(noWait);
  const get = vi.fn(async (url: string) => ok(new URL(url).searchParams.get("page") === "1"
    ? page(Array.from({ length: 10 }, (_, i) => raw(`job-${i}`)), 1, 2)
    : page([raw("job-10")], 2, 2)));
  const r = await loadGetonboardBoard({ tenant: "public" }, get, wait);
  expect(r.body).toHaveLength(11);
  expect(r.discovery).toEqual({ policy: "observations", pages: 2, capped: false });
  expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
  expect(get.mock.calls.every(([url]) => new URL(url).hostname === "www.getonbrd.com")).toBe(true);
});
it("marks the bounded window as capped without treating absence as closure", async () => {
  const r = await loadGetonboardBoard({ tenant: "public" }, async url => {
    const n = Number(new URL(url).searchParams.get("page"));
    return ok(page(Array.from({ length: 10 }, (_, i) => raw(`job-${n}-${i}`)), n, 26));
  }, noWait);
  expect(r.body).toHaveLength(250);
  expect(r.discovery).toEqual({ policy: "observations", pages: 25, capped: true });
});
it("rejects incomplete, repeated, changed and failed pagination", async () => {
  await expect(loadGetonboardBoard({ tenant: "public" }, async () => ok(page([raw()], 1, 2)), noWait)).rejects.toThrow("Incomplete");
  for (const scenario of ["duplicate", "changed", "wrong-page", "failure"] as const) {
    let calls = 0;
    await expect(loadGetonboardBoard({ tenant: "public" }, async () => {
      if (++calls === 1) return ok(page(Array.from({ length: 10 }, (_, i) => raw(`job-${i}`)), 1, 2));
      if (scenario === "failure") return { ok: false, status: 503, error: "HTTP 503", attempts: 2, retryable: true };
      return ok(page([raw(scenario === "duplicate" ? "job-0" : "job-10")], scenario === "wrong-page" ? 1 : 2, scenario === "changed" ? 3 : 2));
    }, noWait)).rejects.toThrow();
  }
});
it("allows a valid empty observation and rejects foreign job URLs and unsupported tenants", async () => {
  const empty = await loadGetonboardBoard({ tenant: "public" }, async () => ok(page([], 1, 0)), noWait);
  expect(empty.body).toEqual([]);
  for (const link of ["https://evil.example/jobs/test-job", "https://www.getonbrd.com/jobs/other", "https://www.getonbrd.com/jobs/test-job?redirect=other"])
    expect(() => getonboard.normalize({ ...raw(), links: { public_url: link } }, "public")).toThrow();
  await expect(loadGetonboardBoard({ tenant: "other" }, async () => ok(page([])), noWait)).rejects.toThrow();
});
