import { describe, expect, it } from "vitest";
import { FEED_ADAPTERS, himalayas, jobicy, remotive, remoteok, weworkremotely } from "./feed-adapters";

const publication = "2026-10-25T12:00:00Z";
const jobicyJob = { id: 12, url: "https://jobicy.com/jobs/12-role", jobTitle: "Engineer", companyName: "Actual Employer",
  jobDescription: "<p>Build useful software.</p><script>alert(1)</script>", jobGeo: "USA", jobType: ["Full-Time"], pubDate: publication,
  salaryMin: 100000, salaryMax: 150000, salaryCurrency: "USD", salaryPeriod: "yearly" };
const himalayasJob = { guid: "https://himalayas.app/companies/acme/jobs/" + "long-slug-".repeat(20),
  applicationLink: "https://himalayas.app/companies/acme/jobs/role?utm_source=api", title: "Engineer", companyName: "Actual Employer",
  description: "<p>Build software.</p>", locationRestrictions: ["United States"], timezoneRestrictions: [-8],
  employmentType: "Full Time", pubDate: 1792929600, expiryDate: 1795608000 };
const remoteokJob = { id: "89", position: "Engineer", company: "Actual Employer", description: "Build software.",
  url: "https://remoteOK.com/remote-jobs/89-role", apply_url: "https://remoteOK.com/remote-jobs/89-role?apply=true", location: "Worldwide", date: publication };
const remotiveJob = { id: 45, title: "Engineer", company_name: "Actual Employer", description: "Build software.",
  url: "https://remotive.com/remote-jobs/45", candidate_required_location: "Worldwide", publication_date: publication };
const wwrJob = { title: "Actual Employer: Engineer", description: "<p>Build software.</p>",
  link: "https://weworkremotely.com/remote-jobs/acme-role", guid: "https://weworkremotely.com/remote-jobs/acme-role",
  region: "Anywhere in the World", country: "🇺🇸 United States of America", pubDate: "Sun, 25 Oct 2026 12:00:00 GMT",
  expires_at: "Wed, 25 Nov 2026 12:00:00 GMT", type: "Full-Time" };
const jobicyPage = (jobs = [jobicyJob]) => ({ jobs, jobCount: jobs.length, nextCursor: null, hasMore: false, success: true, statusCode: 200 });
const xml = (country = "🇺🇸 United States of America") => `<rss version="2.0"><channel><title>We Work Remotely</title><link>https://weworkremotely.com</link><item>
  <title>Actual Employer: Engineer</title><link>https://weworkremotely.com/remote-jobs/acme-role</link>
  <guid isPermaLink="true">https://weworkremotely.com/remote-jobs/acme-role</guid>
  <description><![CDATA[<p>Build &amp; maintain software.</p>]]></description><region>Anywhere in the World</region>
  <country>${country}</country><pubDate>Sun, 25 Oct 2026 12:00:00 GMT</pubDate><expires_at>Wed, 25 Nov 2026 12:00:00 GMT</expires_at>
  </item></channel></rss>`;

describe("public feed normalization", () => {
  it.each([
    [jobicy, jobicyJob], [himalayas, himalayasJob], [remoteok, remoteokJob], [remotive, remotiveJob], [weworkremotely, wwrJob],
  ] as const)("preserves the employer and provider links for $0.source", (adapter, raw) => {
    const job = adapter.normalize(raw, "public", "Feed Provider Is Not Employer");
    expect(job.company).toBe("Actual Employer");
    expect(job.title).toBe("Engineer");
    expect(job.usEligibility).toBe("us");
    expect(job.workMode).toBe("Remote");
    expect(adapter.attribution("public").name).not.toBe(job.company);
    expect(job.sourceUrl).toMatch(/^https:\/\//);
  });

  it("keeps original dates, sanitized text, explicit salary and supplied Jobicy URL", () => {
    const job = jobicy.normalize(jobicyJob, "public");
    expect(job.postedAt).toBe("2026-10-25T12:00:00.000Z");
    expect(job.descriptionText).toBe("Build useful software.");
    expect(job.salary).toMatchObject({ min: 100000, max: 150000, currency: "USD", period: "year" });
    expect(job.applyUrl).toBe(jobicyJob.url);
  });

  it("does not relabel Himalayas update dates as original publication dates", () => {
    const job = himalayas.normalize(himalayasJob, "public");
    expect(job.postedAt).toBeNull();
    expect(job.sourceUpdatedAt).toBe(new Date(himalayasJob.pubDate * 1000).toISOString());
    expect(job.sourceExpiresAt).toBe(new Date(himalayasJob.expiryDate * 1000).toISOString());
    expect(job.applyUrl).toBe(himalayasJob.applicationLink);
    expect(job.sourceUrl).toBe(himalayasJob.guid);
    expect(job.sourceJobId.length).toBeLessThanOrEqual(120);
    expect(himalayas.normalize({ ...himalayasJob, title: "Changed title" }, "public").id).toBe(job.id);
  });

  it.each([[], [1], [5.5]])("quarantines unproven US timezone eligibility %j", (...offsets) => {
    expect(himalayas.normalize({ ...himalayasJob, timezoneRestrictions: offsets }, "public").usEligibility).toBe("unknown");
  });
  it("requires geography as well as compatible timezones", () => {
    expect(himalayas.normalize({ ...himalayasJob, locationRestrictions: ["Canada"] }, "public").usEligibility).toBe("not_us");
    expect(himalayas.normalize({ ...himalayasJob, locationRestrictions: [] }, "public").usEligibility).toBe("us");
    expect(himalayas.normalize({ ...himalayasJob, locationRestrictions: [], timezoneRestrictions: [] }, "public").usEligibility).toBe("unknown");
  });

  it.each(["", "Remote", "USA timezones", "US hours"])("does not assume US eligibility for %j", (jobGeo) => {
    expect(jobicy.normalize({ ...jobicyJob, jobGeo }, "public").usEligibility).toBe("unknown");
  });
  it("rejects explicit US exclusions despite the word Worldwide", () => {
    expect(remotive.normalize({ ...remotiveJob, candidate_required_location: "Worldwide except United States" }, "public").usEligibility).toBe("not_us");
  });
  it("does not infer Remote OK currency or interval", () => {
    expect(remoteok.normalize({ ...remoteokJob, salary_min: 100000, salary_max: 120000 }, "public").salary)
      .toMatchObject({ currency: null, period: null });
  });

  it("prioritizes WWR country restrictions over Worldwide and keeps expiry", () => {
    const job = weworkremotely.normalize({ ...wwrJob, country: "🇨🇦 Canada" }, "public");
    expect(job.usEligibility).toBe("not_us");
    expect(job.sourceExpiresAt).toBe("2026-11-25T12:00:00.000Z");
    expect(weworkremotely.normalize({ ...wwrJob, country: "" }, "public").usEligibility).toBe("us");
  });
});

describe("feed envelope validation", () => {
  it("parses complete Jobicy pages and rejects duplicate IDs / contradictory pagination", () => {
    expect(jobicy.parseListing(jobicyPage())).toHaveLength(1);
    expect(() => jobicy.parseListing(jobicyPage([jobicyJob, jobicyJob]))).toThrow("Duplicate");
    expect(() => jobicy.parseListing({ ...jobicyPage(), jobCount: 20 })).toThrow();
    expect(() => jobicy.parseListing({ ...jobicyPage(), hasMore: true })).toThrow();
    expect(() => jobicy.parseListing({ ...jobicyPage(), success: false })).toThrow();
  });
  it("validates Himalayas count and provider URLs", () => {
    expect(himalayas.parseListing({ jobs: [himalayasJob], totalCount: 50 })).toHaveLength(1);
    expect(() => himalayas.parseListing({ jobs: [himalayasJob], totalCount: -1 })).toThrow();
    expect(() => himalayas.parseListing({ jobs: [himalayasJob], totalCount: 0 })).toThrow();
    expect(() => himalayas.normalize({ ...himalayasJob, applicationLink: "https://attacker.example/apply" }, "public")).toThrow();
    expect(() => himalayas.normalize({ ...himalayasJob, guid: "https://himalayas.app@attacker.example/jobs/1" }, "public")).toThrow();
  });
  it("skips Remote OK metadata only when metadata shape is valid", () => {
    expect(remoteok.parseListing([{ legal: "Credit Remote OK", last_updated: 1 }, remoteokJob])).toHaveLength(1);
    expect(() => remoteok.parseListing([remoteokJob])).toThrow();
    expect(() => remoteok.parseListing([{ legal: "", last_updated: 1 }])).toThrow();
  });
  it("rejects malformed Remotive totals and unsupported link schemes", () => {
    expect(remotive.parseListing({ jobs: [remotiveJob], "job-count": 1, "total-job-count": 1 })).toHaveLength(1);
    expect(() => remotive.parseListing({ jobs: [remotiveJob], "job-count": 2 })).toThrow();
    expect(() => remotive.normalize({ ...remotiveJob, url: "javascript:alert(1)" }, "public")).toThrow();
  });
  it("parses WWR CDATA and GUID attributes without interpreting HTML as XML", () => {
    const [raw] = weworkremotely.parseListing(xml("🇨🇦 Canada"));
    const job = weworkremotely.normalize(raw, "public");
    expect(job.descriptionText).toBe("Build & maintain software.");
    expect(job.usEligibility).toBe("not_us");
  });
  it("rejects XML DTDs, entity declarations, malformed XML, and invalid expiry", () => {
    expect(() => weworkremotely.parseListing(`<!DOCTYPE rss [<!ENTITY file SYSTEM "file:///etc/passwd">]>${xml()}`)).toThrow();
    expect(() => weworkremotely.parseListing(xml().replace("</channel>", ""))).toThrow();
    expect(() => weworkremotely.normalize({ ...wwrJob, expires_at: "invalid" }, "public")).toThrow();
  });
  it("registers exactly the five researched feeds", () => {
    expect(Object.keys(FEED_ADAPTERS).sort()).toEqual(["himalayas", "jobicy", "remoteok", "remotive", "weworkremotely"]);
  });
});
