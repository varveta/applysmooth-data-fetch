import { expect, it, vi } from "vitest";
import { loadRailsJobsBoard } from "../../../ingest/lib/fetch-rails-jobs";
import { evaluateGates } from "./gates";
import { parseRailsJobsXml, railsjobs, RAILS_JOBS_ORIGIN } from "./rails-jobs";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const description = `<h2>Responsibilities</h2><p>${"Build reliable services and support customers. ".repeat(12)}</p><ul><li>Original final requirement.</li></ul>`;
const url = (id = 1) => `${RAILS_JOBS_ORIGIN}/jobs/${id}-platform-engineer`;
const item = (id = 1, location = "Location: Remote US", body = description) => `<item>
  <title>Platform Engineer at Example Employer</title><description>${escape(`<p>${location}</p>${body}`)}</description>
  <pubDate>Thu, 29 Oct 2026 09:41:42 +0100</pubDate><link>${url(id)}</link><guid>${url(id)}</guid>
  <privateMetadata>not retained</privateMetadata>
</item>`;
const xml = (items = item()) => `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Rails Job Board</title><description>Job feed</description><link>${RAILS_JOBS_ORIGIN}/</link>${items}
</channel></rss>`;
const ok = (body: unknown) => ({ ok: true as const, status: 200, body, attempts: 1, bytes: 100 });
const normalize = (location: string, body = description) => railsjobs.normalize(parseRailsJobsXml(xml(item(1, location, body)))[0], "public");

it("preserves full description, provider identity, original timezone and per-job credit", () => {
  const raw = parseRailsJobsXml(xml())[0];
  const job = railsjobs.normalize(raw, "public", "Ignored company override");
  expect(job).toMatchObject({
    source: "railsjobs", tenant: "public", sourceJobId: "1", id: "railsjobs:public:1",
    title: "Platform Engineer", company: "Example Employer", postedAt: "2026-10-29T08:41:42.000Z",
    sourceUpdatedAt: null, sourceUrl: url(), applyUrl: url(), usEligibility: "us", workMode: "Remote",
  });
  expect(job.descriptionText).toContain("• Original final requirement.");
  expect(job.descriptionText).not.toContain("<p>");
  expect(raw.guid).toBe(url());
  expect(railsjobs.postingId(raw)).toBe("1");
  expect(railsjobs.attribution("public", job)).toEqual({ name: "Rails Job Board", url: url() });
  expect(job.evidence).toContainEqual(expect.objectContaining({ field: "usEligibility", method: "text-pattern", sourceField: "description" }));
  expect(raw).not.toHaveProperty("privateMetadata");
  expect(railsjobs.normalize(raw, "public").contentHash).toBe(job.contentHash);
});

it("uses affirmative role location statements without inferring from offices, clients or remote", () => {
  for (const location of [
    "Our clients are in the United States. Our headquarters are New York, NY. We work remotely.",
    "Location: Remote", "Location: Remote, North America", "Location: Remote, reporting to New York City",
    "This role is not fully remote (based in the U.S.).", "Location: Remote outside United States",
  ]) expect(normalize(location).usEligibility).toBe("unknown");
  expect(normalize("This role is fully remote (based in the U.S.), reporting to our team.").usEligibility).toBe("us");
  expect(normalize("This is a remote opportunity and is open to candidates in the United States, Canada, or Mexico.").usEligibility).toBe("us");
  expect(normalize("Fully remote based in Latin America").usEligibility).toBe("not_us");
  expect(normalize("Location: Remote Canada").usEligibility).toBe("not_us");
  expect(normalize("Location: Remote US", `${description}<p>Location: Remote Canada</p>`).usEligibility).toBe("unknown");
});

it("does not accept US clock alignment as a hiring location", () => {
  for (const location of [
    "Location: Remote — US working hours", "Location: Remote (US time zones)",
    "Location: Remote, United States business hours", "Location: Remote, overlap with US team hours",
    "Location: Remote, US timezone preferred", "Location: Remote, US EST schedule",
  ]) {
    const job = normalize(location);
    expect(job.usEligibility).toBe("unknown");
    expect(evaluateGates(job, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z", open: true, duplicateOf: null }))
      .toMatchObject({ status: "quarantined", reasons: expect.arrayContaining(["us_eligibility_unknown"]) });
  }
  expect(normalize("Location: Remote US").usEligibility).toBe("us");
});

it("quarantines separate US exclusions instead of accepting a conflicting US label", () => {
  for (const restriction of [
    "This role is not open to US applicants.",
    "We cannot hire candidates based in the United States.",
    "Applicants from the U.S. are not eligible.",
    "We do not accept applications from the United States.",
    "US applicants are excluded.",
    "Candidates must reside outside the United States.",
  ]) {
    for (const body of [`<p>${restriction}</p>${description}`, `${description}<p>${restriction}</p>`]) {
      const job = normalize("Location: Remote US", body);
      expect(job.usEligibility).toBe("unknown");
      expect(evaluateGates(job, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z", open: true, duplicateOf: null }))
        .toMatchObject({ status: "quarantined", reasons: expect.arrayContaining(["us_eligibility_unknown"]) });
    }
  }
  // Do not read the pronoun "us" as a country or confuse sponsorship with location.
  expect(normalize("Location: Remote US", `${description}<p>Please do not contact us about applications.</p><p>Visa sponsorship is not available.</p>`).usEligibility).toBe("us");
});

it("never replaces missing or invalid publication dates with observation time", () => {
  for (const feed of [
    xml().replace(/<pubDate>[^<]+<\/pubDate>/, ""),
    xml().replace("Thu, 29 Oct 2026 09:41:42 +0100", "not a date"),
  ]) expect(() => parseRailsJobsXml(feed)).toThrow();
  const old = parseRailsJobsXml(xml().replace("29 Oct 2026", "29 Oct 2025"))[0];
  expect(railsjobs.normalize(old, "public").postedAt).toBe("2025-10-29T08:41:42.000Z");
  const oversized = normalize("Location: Remote US", "x".repeat(50_001));
  expect(evaluateGates(oversized, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z", open: true, duplicateOf: null }).reasons)
    .toContain("description_too_long");
});

it("rejects truncated/foreign feeds, XML declarations, duplicate identities and mismatched GUIDs", () => {
  for (const feed of [
    xml().replace("</channel>", ""), "<html>not RSS</html>",
    `<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>${xml()}`,
    xml().replace("<title>Rails Job Board</title>", "<title>Other feed</title>"),
    xml(item() + item()), xml(item() + item().replaceAll("-platform-engineer", "-renamed-role")),
    xml().replace(`<guid>${url()}</guid>`, `<guid>${url(2)}</guid>`),
    xml(Array.from({ length: 1001 }, (_, i) => item(i + 1)).join("")),
  ]) expect(() => parseRailsJobsXml(feed)).toThrow();
  const noCompany = parseRailsJobsXml(xml().replace("Platform Engineer at Example Employer", "Platform Engineer"))[0];
  expect(() => railsjobs.normalize(noCompany, "public")).toThrow("lacks employer");
});

it("rejects unsafe URLs and foreign tenants before requesting or normalizing", async () => {
  for (const unsafe of [
    url().replace("https:", "http:"), url().replace("jobs.rubyonrails.org", "evil.example"),
    url().replace("https://", "https://user@"), url().replace(".org/", ".org:443/"),
    `${url()}?redirect=elsewhere`, `${url()}#fragment`, `${url()}/`, url().replace("/1-", "/0-"),
    url().replace("/jobs/", "/jobs/%2e%2e/"),
  ]) expect(() => parseRailsJobsXml(xml().replaceAll(url(), escape(unsafe)))).toThrow();
  const get = vi.fn(async () => ok(xml()));
  await expect(loadRailsJobsBoard({ tenant: "other" }, get)).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
  expect(() => railsjobs.normalize(parseRailsJobsXml(xml())[0], "other")).toThrow();
});

it("loads a bounded provider-selected window with absence never considered closure", async () => {
  const get = vi.fn(async () => ok(xml()));
  const result = await loadRailsJobsBoard({ tenant: "public" }, get);
  expect(result.body).toHaveLength(1);
  expect(result.discovery).toEqual({ policy: "observations", pages: 1, capped: true, maximum_jobs: 1000 });
  expect(get).toHaveBeenCalledExactlyOnceWith(`${RAILS_JOBS_ORIGIN}/jobs.rss`, {
    attempts: 2, timeoutMs: 20_000, maxBytes: 12_000_000, responseType: "text",
    accept: "application/rss+xml, application/xml, text/xml", redirect: "error",
  });
  const empty = await loadRailsJobsBoard({ tenant: "public" }, async () => ok(xml("")));
  expect(empty.body).toEqual([]);
  expect(empty.discovery.policy).toBe("observations");
  expect(empty.discovery.capped).toBe(true);
  await expect(loadRailsJobsBoard({ tenant: "public" }, async () => ({
    ok: false, status: 403, error: "HTTP 403", attempts: 1, retryable: false,
  }))).rejects.toThrow("HTTP 403");
  await expect(loadRailsJobsBoard({ tenant: "public" }, async () => ok("<rss>truncated"))).rejects.toThrow();
});
