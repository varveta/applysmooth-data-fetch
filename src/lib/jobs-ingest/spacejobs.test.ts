import { expect, it, vi } from "vitest";
import { parseSpacejobsXml, spacejobs, spacejobsUrl, SPACEJOBS_FEED_URL } from "./spacejobs";
import { evaluateGates } from "./gates";
import { UnverifiedPostingError } from "./normalization-error";
import { loadSpacejobsBoard } from "../../../ingest/lib/fetch-spacejobs";
import { prepareBoard } from "../../../ingest/stateless";

const id = "2570d7e745f1";
const url = `https://spacejobs.now/jobs/security-engineer-${id}?utm_source=job-feed&utm_medium=job-feed&utm_campaign=us`;
const description = `<p>${"Build reliable spacecraft infrastructure. ".repeat(30)}</p><h2>Requirements</h2><p>U.S. citizenship required.</p>`;
const posting = { referencenumber: id, url, title: "Security Engineer", company: "Employer", description,
  location: "Seattle, WA", country: "US", eligibility: "one-country", eligiblecountries: "US", jobtype: "full-time",
  date: "Mon, 02 Nov 2026 19:36:41 GMT", updated: "Mon, 02 Nov 2026 20:00:00 GMT", logo: "unrelated metadata" };
function xml(jobs: Record<string, unknown>[] = [posting], total = jobs.length, page = 1) {
  return `<?xml version="1.0"?><source><publisher>SpaceJobs.Now</publisher><publisherurl>https://spacejobs.now</publisherurl><market>US</market>` +
    `<totaljobs>${total}</totaljobs><page>${page}</page><pages>${Math.max(1, Math.ceil(total / 600))}</pages>` +
    jobs.map(job => `<job>${Object.entries(job).filter(([, value]) => value !== undefined).map(([key, value]) =>
      `<${key}><![CDATA[${value}]]></${key}>`).join("")}</job>`).join("") + "</source>";
}
const now = new Date("2026-11-02T21:00:00Z");
const gates = (raw: unknown) => evaluateGates(spacejobs.normalize(raw, "public"), {
  now, open: true, lastSeenAt: now.toISOString(), duplicateOf: null,
});
const ok = (body: unknown) => ({ ok: true as const, status: 200, attempts: 1, bytes: 500, body });

it("preserves full description, stable feed identity, exact application backlink and update date", () => {
  const [raw] = parseSpacejobsXml(xml()).jobs;
  expect(raw).not.toHaveProperty("logo");
  const job = spacejobs.normalize(raw, "public");
  expect(job).toMatchObject({ source: "spacejobs", tenant: "public", sourceJobId: id, requisitionKey: null,
    sourceUrl: url, applyUrl: url, company: "Employer", usEligibility: "us", jobType: "Full-time",
    postedAt: null, sourceUpdatedAt: "2026-11-02T20:00:00.000Z" });
  expect(job.descriptionText).toContain("U.S. citizenship required.");
  expect(job.descriptionText.match(/Build reliable spacecraft infrastructure\./g)).toHaveLength(30);
  expect(job.descriptionText.length).toBeGreaterThan(1000);
  expect(spacejobs.attribution("public", job)).toEqual({ name: "SpaceJobs.Now", url });
  expect(() => spacejobs.attribution("public")).toThrow();
  expect(gates(raw).status).toBe("accepted");
});

it("never treats mixed original/first-seen dates as original publication dates", () => {
  for (const date of [undefined, "", "Mon, 01 Jan 2024 00:00:00 GMT"])
    expect(spacejobs.normalize({ ...posting, date, updated: undefined }, "public"))
      .toMatchObject({ postedAt: null, sourceUpdatedAt: null });
  expect(() => spacejobs.normalize({ ...posting, date: "bad date" }, "public")).toThrow();
});

it("keeps missing content visible to quality gates instead of inventing facts", () => {
  expect(gates({ ...posting, title: "", company: "", description: "" })).toMatchObject({
    status: "rejected", reasons: ["missing_title", "missing_company", "description_too_short"],
  });
  expect(gates({ ...posting, description: "x".repeat(50_001) }).reasons).toContain("description_too_long");
});

it("does not infer US eligibility from the US feed or generic remote wording", () => {
  const foreign = { ...posting, country: "CA", location: "Toronto, Canada", eligiblecountries: "CA" };
  expect(spacejobs.normalize(foreign, "public").usEligibility).toBe("not_us");
  expect(gates(foreign).reasons).toContain("not_us");
  const unknown = { ...posting, country: undefined, location: "Remote", remotetype: undefined,
    eligibility: "worldwide", eligiblecountries: undefined };
  expect(spacejobs.normalize(unknown, "public").usEligibility).toBe("unknown");
  expect(gates(unknown).reasons).toContain("us_eligibility_unknown");
});

it("preserves explicit remote hiring reach independently of the physical office", () => {
  for (const eligibility of ["worldwide", "most-countries", "several-countries"])
    expect(spacejobs.normalize({ ...posting, country: "GB", location: "London, United Kingdom", remotetype: "Fully remote",
      eligibility, eligiblecountries: eligibility === "several-countries" ? "GB,US" : undefined }, "public"))
      .toMatchObject({ usEligibility: "us", workMode: "Remote" });
});

it("quarantines excluded, contradictory, missing eligibility and explicit talent pools", () => {
  for (const change of [
    { excludedcountries: "US" }, { eligiblecountries: "CA" }, { eligiblecountries: undefined },
    { eligiblecountries: "US,CA", excludedcountries: "CA" }, { location: "Berlin, Germany" }, { talentpool: "yes" },
  ]) expect(() => spacejobs.normalize({ ...posting, ...change }, "public")).toThrow(UnverifiedPostingError);
});

it("honors an explicit source expiration without fabricating one", () => {
  expect(gates({ ...posting, expirationdate: "2026-11-01" }).reasons).toContain("closed_at_source");
  expect(spacejobs.normalize(posting, "public").sourceExpiresAt).toBeUndefined();
});

it("preserves original zero salary placeholders as text without publishing invalid numeric pay", () => {
  const job = spacejobs.normalize({ ...posting, description: description + "<p>Primary Level Salary Range: $0.00 - $0.00</p>" }, "public");
  expect(job.descriptionText).toContain("Primary Level Salary Range: $0.00 - $0.00");
  expect(job.salary).toBeNull();
});

it("quarantines an ineligible peer while retaining every discovered source ID", () => {
  const peer = { ...posting, referencenumber: "abcdef123456", url: url.replace(id, "abcdef123456"), excludedcountries: "US" };
  const result = prepareBoard({ source: "spacejobs", tenant: "public", company: "SpaceJobs.Now" }, [posting, peer], now,
    { source: "spacejobs", tenant: "public", complete: true, identities: [] });
  expect(result.fetched_count).toBe(2);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ source_job_id: id, source_url: url, apply_url: url,
    attribution_name: "SpaceJobs.Now", attribution_url: url, posted_at: null });
  expect(result.quarantined_posting_ids).toEqual(["spacejobs:public:abcdef123456"]);
});

it("requires exact raw HTTPS identity URL and the observed US-feed query", () => {
  expect(spacejobsUrl(url, id)).toBe(url);
  for (const unsafe of [
    url.replace("https://", "http://"), url.replace("spacejobs.now", "spacejobs.now.attacker.test"),
    url.replace("spacejobs.now", "spacejobs.now:443"), url.replace("spacejobs.now", "user@spacejobs.now"),
    url.replace("https://", "HTTPS://"), url.replace("/jobs/", "/jobs/../jobs/"),
    url.replace("security", "%73ecurity"), url.replace(id, "abcdef123456"),
    url + "#fragment", url + "&job=other", url + "&utm_source=other", url.replace("utm_campaign=us", "utm_campaign=ca"),
    url.split("?")[0], url.replace("utm_source=job-feed&utm_medium=job-feed", "utm_medium=job-feed&utm_source=job-feed"),
    " " + url, url + "\n",
  ]) expect(() => spacejobsUrl(unsafe, id), unsafe).toThrow();
});

it("fails malformed XML, entities, duplicate identities and incorrect feed metadata", () => {
  for (const invalid of [
    "<source>", xml().replace("<source>", '<!DOCTYPE source [<!ENTITY external SYSTEM "file:///etc/passwd">]><source>'),
    xml().replace("<market>US</market>", "<market>CA</market>"), xml([posting, posting]), xml([posting], 2),
    xml([posting], 1, 2), xml().replace("<pages>1</pages>", "<pages>2</pages>"),
  ]) expect(() => parseSpacejobsXml(invalid)).toThrow();
  expect(() => parseSpacejobsXml("x".repeat(20_000_001))).toThrow("oversized");
  expect(() => spacejobs.postingId({ ...posting, referencenumber: "bad" })).toThrow();
  expect(() => spacejobs.listUrl("other")).toThrow();
});

it("loads one disclosed bounded observation page with no absence-based closure", async () => {
  const jobs = Array.from({ length: 600 }, (_, i) => {
    const nextId = i.toString(16).padStart(12, "0");
    return { ...posting, referencenumber: nextId, url: url.replace(id, nextId) };
  });
  const get = vi.fn(async () => ok(xml(jobs, 15_046)));
  const result = await loadSpacejobsBoard({ tenant: "public" }, get);
  expect(result.body).toHaveLength(600);
  expect(result.discovery).toEqual({ policy: "observations", pages: 1, capped: true, maximum_jobs: 600,
    reported_total: 15_046, reported_pages: 26, publication_dates: "unknown_mixed_with_first_seen" });
  expect(get).toHaveBeenCalledExactlyOnceWith(SPACEJOBS_FEED_URL, expect.objectContaining({ redirect: "error",
    responseType: "text", maxBytes: 20_000_000, attempts: 1 }));
  expect(() => parseSpacejobsXml(xml([...jobs, posting], 601))).toThrow();
  expect(() => spacejobs.parseListing([...jobs, posting])).toThrow();
});

it("fails an exhausted feed read instead of returning an empty successful snapshot", async () => {
  await expect(loadSpacejobsBoard({ tenant: "public" }, async () => ({ ok: false, status: 503,
    attempts: 1, retryable: true, error: "HTTP 503" }), async () => {})).rejects.toThrow("HTTP 503");
});

it("waits at least one minute before its single permitted transient retry", async () => {
  let calls = 0;
  const get = vi.fn(async () => ++calls === 1 ? { ok: false as const, status: 503, attempts: 1,
    retryable: true, error: "HTTP 503" } : ok(xml()));
  const pause = vi.fn(async () => {});
  expect((await loadSpacejobsBoard({ tenant: "public" }, get, pause)).attempts).toBe(2);
  expect(get).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledExactlyOnceWith(60_000);
});
