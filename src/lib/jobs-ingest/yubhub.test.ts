import { expect, it, vi } from "vitest";
import { hydrateYubhubPosting, yubhub, yubhubEmployerUrl, YubhubPosting } from "./yubhub";
import { evaluateGates } from "./gates";
import { loadYubhubBoard } from "../../../ingest/lib/fetch-yubhub";
import { prepareBoard } from "../../../ingest/stateless";
const url = "https://example.wd5.myworkdayjobs.com/en-US/Careers/job/US-NY-New-York/Engineer_R123-2";
const discovery = { "@type": "JobPosting", identifier: { name: "YubHub", value: "job_abc-123" }, title: "Engineer", url, "x-apply-url": url,
  description: "Lossy feed summary", datePosted: "2026-11-02", "x-work-arrangement": "remote", payment: "must strip" };
const original = { "@type": "JobPosting", identifier: { value: "R123" }, title: "Engineer",
  description: "<p>" + "Build secure platforms. ".repeat(30) + "U.S. citizenship required.</p>",
  datePosted: "2026-10-29", hiringOrganization: { name: "Original Employer" }, employmentType: "FULL_TIME",
  jobLocation: { address: { addressLocality: "New York", addressRegion: "NY", addressCountry: "United States" } } };
const html = (job: unknown = original) => `<script type="application/ld+json">${JSON.stringify(job)}</script>`;
const feed = (jobs: unknown[]) => ({ "x-feed-size-limit": 100, "x-facet": { type: "country", slug: "united-states", count: jobs.length }, jobs });
const ok = (body: unknown) => ({ ok: true as const, status: 200, attempts: 1, bytes: 100, body });
const pause = async () => {};

it("uses full employer facts instead of enriched feed text, date, company or remote flags", () => {
  const hydrated = hydrateYubhubPosting(discovery, html());
  const job = yubhub.normalize(hydrated, "public");
  expect(job).toMatchObject({ source: "yubhub", sourceJobId: "job_abc-123", requisitionKey: "R123", company: "Original Employer",
    postedAt: "2026-10-29T00:00:00.000Z", usEligibility: "us", applyUrl: url, sourceUrl: url, workMode: null });
  expect(job.descriptionText).toContain("U.S. citizenship required.");
  expect(job.descriptionText).not.toContain("Lossy");
  expect(hydrated).not.toHaveProperty("payment");
  expect(hydrated).not.toHaveProperty("description");
  expect(yubhub.attribution("public")).toEqual({ name: "Data by YubHub", url: "https://yubhub.co" });
});
it("leaves missing original dates unknown and does not infer US from the feed country", () => {
  const hydrated = hydrateYubhubPosting(discovery, html({ ...original, datePosted: undefined,
    jobLocation: { address: { addressLocality: "Remote" } } }));
  expect(yubhub.normalize(hydrated, "public")).toMatchObject({ postedAt: null, usEligibility: "unknown" });
  expect(() => yubhub.normalize(hydrated, "other")).toThrow();
  expect(() => YubhubPosting.parse(discovery)).toThrow();
});
it.each([
  url.replace("example.wd5.myworkdayjobs.com", "example.wd5.myworkdayjobs.com.attacker.test"),
  url.replace("https://", "http://"), url + "?redirect=https://attacker.test", url + "#other",
  url.replace("https://", "https://user:password@"), url.replace("/Engineer_R123-2", "/%2fprivate"),
  "https://127.0.0.1/en-US/Careers/job/US-NY/Engineer_R123",
])("rejects unsafe or unsupported employer URL %s", value => expect(() => yubhubEmployerUrl(value)).toThrow());
it("requires one original requisition matching the URL and rejects conflicting JSON-LD", () => {
  for (const body of [html() + html(), html({ ...original, identifier: { value: "R999" } })])
    expect(() => hydrateYubhubPosting(discovery, body)).toThrow();
});
it("loads bounded observations with rate spacing and redirects disabled", async () => {
  const get = vi.fn(async (request: string) => ok(request.includes("feeds.yubhub") ? feed([discovery]) : html()));
  const wait = vi.fn(pause);
  const result = await loadYubhubBoard({ tenant: "public" }, get, wait);
  expect(result.body).toHaveLength(1);
  expect(result.discovery).toEqual({ policy: "observations", pages: 2, capped: true });
  expect(result.attempts).toBe(2);
  expect(wait).toHaveBeenCalledWith(750);
  expect(get.mock.calls).toHaveLength(2);
  expect((get.mock.calls as unknown[][])[1][1]).toMatchObject({ redirect: "error", accept: "text/html" });
});
it("rejects duplicate discovery IDs and count mismatch", async () => {
  for (const body of [feed([discovery, discovery]), { ...feed([discovery]), "x-facet": { type: "country", slug: "united-states", count: 2 } }])
    await expect(loadYubhubBoard({ tenant: "public" }, async () => ok(body), pause)).rejects.toThrow();
});

it("keeps healthy original jobs while missing and failed details are quarantined without summary fallback", async () => {
  const missingUrl = url.replace("R123-2", "R124");
  const unavailableUrl = url.replace("R123-2", "R125");
  const missing = { ...discovery, identifier: { name: "YubHub", value: "job_missing-1" }, url: missingUrl, "x-apply-url": missingUrl };
  const unavailable = { ...discovery, identifier: { name: "YubHub", value: "job_unavailable-1" }, url: unavailableUrl, "x-apply-url": unavailableUrl };
  const result = await loadYubhubBoard({ tenant: "public" }, async request => {
    if (request.includes("feeds.yubhub")) return ok(feed([discovery, missing, unavailable]));
    if (request === url) return ok(html());
    if (request === missingUrl) return ok("<html><title></title>Application shell</html>");
    return { ok: false, status: 404, error: "HTTP 404", attempts: 1, retryable: false };
  }, pause);
  expect(result.body).toHaveLength(3);
  expect(result.discovery).toEqual({ policy: "observations", pages: 4, capped: true });
  expect(result.body[1]).toMatchObject({ original: null, hydration_error: "missing_original" });
  expect(result.body[2]).toMatchObject({ original: null, hydration_error: "detail_unavailable" });
  expect(yubhub.postingId(result.body[1])).toBe("job_missing-1");
  expect(() => yubhub.normalize(result.body[1], "public")).toThrow("Original employer posting unavailable");
  const target = { source: "yubhub" as const, tenant: "public", company: "YubHub" };
  const prepared = prepareBoard(target, result.body, new Date("2026-11-02T00:00:00Z"), {
    source: "yubhub", tenant: "public", complete: true, identities: [],
  });
  expect(prepared.rows).toHaveLength(1);
  expect(prepared.rows[0]).toMatchObject({ source_job_id: "job_abc-123", source_url: url,
    attribution_name: "Data by YubHub", attribution_url: "https://yubhub.co" });
  expect(prepared.fetched_count).toBe(3);
  expect(prepared.gates.quarantined).toBe(2);
  expect(prepared.quarantined_posting_ids).toEqual(["yubhub:public:job_missing-1", "yubhub:public:job_unavailable-1"]);
});

it("validates unverified discovery URLs and never accepts contradictory hydration states", () => {
  const unverified = hydrateYubhubPosting(discovery, "<html>Application shell</html>");
  for (const invalid of [
    { ...unverified, url: "https://attacker.test/job" },
    { ...unverified, "x-apply-url": url.replace("R123-2", "R999") },
    { ...unverified, hydration_error: undefined },
    { ...unverified, original },
  ]) expect(() => yubhub.postingId(invalid)).toThrow();
});

it("hard-fails the aggregate response budget even when a peer is unverified", async () => {
  await expect(loadYubhubBoard({ tenant: "public" }, async request => request.includes("feeds.yubhub")
    ? ok(feed([discovery])) : { ...ok("<html>Shell</html>"), bytes: 40_000_001 }, pause))
    .rejects.toThrow("aggregate response budget exceeded");
});


it("uses original employer titles and gates missing employer names without inventing feed facts", () => {
  const hydrated = hydrateYubhubPosting(discovery, html({ ...original, title: "Engineer (Original requisition title)", hiringOrganization: { name: "" } }));
  const job = yubhub.normalize(hydrated, "public");
  expect(job.title).toBe("Engineer (Original requisition title)");
  expect(job.company).toBe("");
  const now = new Date("2026-11-02T00:00:00Z");
  expect(evaluateGates(job, { now, open: true, lastSeenAt: now.toISOString(), duplicateOf: null })).toMatchObject({ status: "rejected", reasons: ["missing_company"] });
});


it("keeps identified postings with missing original descriptions for rejection by quality gates", () => {
  const job = yubhub.normalize(hydrateYubhubPosting(discovery, html({ ...original, description: undefined })), "public");
  expect(job.descriptionText).toBe("");
  const now = new Date("2026-11-02T00:00:00Z");
  expect(evaluateGates(job, { now, open: true, lastSeenAt: now.toISOString(), duplicateOf: null })).toMatchObject({ status: "rejected", reasons: ["description_too_short"] });
});

it("gates empty original titles and preserves blank Workday dates as unknown", () => {
  const job = yubhub.normalize(hydrateYubhubPosting(discovery, html({ ...original,
    title: "", datePosted: "", validThrough: "   ",
  })), "public");
  expect(job).toMatchObject({ title: "", postedAt: null });
  const now = new Date("2026-11-02T00:00:00Z");
  expect(evaluateGates(job, { now, open: true, lastSeenAt: now.toISOString(), duplicateOf: null })).toMatchObject({
    status: "rejected", reasons: ["missing_title"],
  });
  expect(() => hydrateYubhubPosting(discovery, html({ ...original, datePosted: "not a date" }))).toThrow();
});
