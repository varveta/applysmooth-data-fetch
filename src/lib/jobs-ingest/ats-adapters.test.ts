import { describe, expect, it } from "vitest";
import { ATS_ADAPTERS, parsePersonioXml } from "./ats-adapters";

const description = "<p>Build dependable software systems with TypeScript and SQL.</p>";
const smart = {
  id: "123", name: "Software Engineer", company: { name: "Example Inc", identifier: "example" },
  location: { city: "Austin", region: "TX", country: "us", remote: true },
  releasedDate: "2026-10-20T12:00:00Z", postingUrl: "https://jobs.smartrecruiters.com/example/123",
  applyUrl: "https://jobs.smartrecruiters.com/example/123?oga=true", active: true, visibility: "PUBLIC",
  jobAd: { sections: { jobDescription: { title: "Responsibilities", text: description } } },
};
const workable = {
  shortcode: "ABC123", title: "Software Engineer", description,
  url: "https://example.workable.com/jobs/123", shortlink: "https://apply.workable.com/j/ABC123",
  application_url: "https://apply.workable.com/j/ABC123/apply/", published_on: "2026-10-20", created_at: "2026-09-01",
  employment_type: "Full-time", locations: [
    { city: "London", country: "United Kingdom", countryCode: "GB" },
    { city: "Austin", region: "Texas", countryCode: "US" },
  ],
};
const recruitee = {
  id: 456, title: "Software Engineer", company_name: "Example Inc", status: "published", description,
  requirements: "<p>Experience with SQL required.</p>", careers_url: "https://example.recruitee.com/o/engineer",
  careers_apply_url: "https://example.recruitee.com/o/engineer/c/new", location: "London, UK",
  published_at: "2026-10-20 12:30:00 UTC", created_at: "2026-09-01 12:00:00 UTC", updated_at: "2026-10-21 13:00:00 UTC",
  close_at: "2026-11-01 00:00:00 UTC", employment_type_code: "fulltime_permanent",
  locations: [{ city: "London", country_code: "GB" }, { city: "Austin", state: "Texas", country_code: "US" }],
};
const personio = (positions: string) => `<?xml version="1.0" encoding="UTF-8"?><workzag-jobs>${positions}</workzag-jobs>`;
const position = `<position><id>00123</id><name>Software Engineer</name><subcompany>Example Inc</subcompany>
<office>Berlin, Germany</office><additionalOffices><office>Austin, TX, United States</office><office>Paris, France</office></additionalOffices>
<createdAt>2026-10-20T12:00:00+00:00</createdAt><schedule>full-time</schedule>
<jobDescriptions><jobDescription><name>Responsibilities</name><value><![CDATA[${description}]]></value></jobDescription></jobDescriptions></position>`;

describe("public ATS normalization", () => {
  it("preserves SmartRecruiters source identity, company, application link, posting date and lowercase US code", () => {
    const adapter = ATS_ADAPTERS.smartrecruiters;
    const [raw] = adapter.parseListing({ jobs: [smart] });
    expect(adapter.normalize(raw, "example", "Incorrect company")).toMatchObject({
      id: "smartrecruiters:example:123", company: "Example Inc", usEligibility: "us",
      postedAt: "2026-10-20T12:00:00.000Z", applyUrl: smart.applyUrl, sourceUrl: smart.postingUrl,
      workMode: "Remote", descriptionText: "Responsibilities\nBuild dependable software systems with TypeScript and SQL.",
    });
  });
  it.each([{ active: false }, { visibility: "INTERNAL" }, { jobAd: {} }, { applyUrl: "javascript:alert(1)" }])(
    "rejects inactive, private or incomplete SmartRecruiters data before reconciliation: %j", (change) => {
      expect(() => ATS_ADAPTERS.smartrecruiters.parseListing({ jobs: [{ ...smart, ...change }] })).toThrow();
    },
  );
  it("uses Workable shortcode and envelope employer, scans every location and preserves source dates", () => {
    const adapter = ATS_ADAPTERS.workable;
    const [raw] = adapter.parseListing({ name: "Example Inc", jobs: [workable] });
    expect(adapter.postingId(raw)).toBe("ABC123");
    expect(adapter.normalize(raw, "example", "Wrong name")).toMatchObject({
      sourceJobId: "ABC123", company: "Example Inc", usEligibility: "us", jobType: "Full-time",
      postedAt: "2026-10-20T00:00:00.000Z", sourceUrl: workable.shortlink, applyUrl: workable.application_url,
    });
  });
  it("merges Workable country variants into one identity while retaining every location", () => {
    const canada = { ...workable, country: "Canada", locations: [{ country: "Canada", countryCode: "CA", city: "" }] };
    const us = { ...workable, country: "United States", locations: [{ country: "United States", countryCode: "US", city: null }] };
    const listing = ATS_ADAPTERS.workable.parseListing({ name: "Example Inc", jobs: [canada, us, us] });
    expect(listing).toHaveLength(1);
    const job = ATS_ADAPTERS.workable.normalize(listing[0], "example");
    expect(job.usEligibility).toBe("us");
    expect(job.locations.map((location) => location.country)).toEqual(["CA", "US"]);
    expect(job.sourceJobId).toBe("ABC123");
    expect(job.postedAt).toBe("2026-10-20T00:00:00.000Z");
  });
  it("does not infer US eligibility from countryless remote Workable roles", () => {
    const [raw] = ATS_ADAPTERS.workable.parseListing({ name: "Example Inc", jobs: [{ ...workable, locations: [], telecommuting: true }] });
    expect(ATS_ADAPTERS.workable.normalize(raw, "example").usEligibility).toBe("unknown");
  });
  it("reads Personio XML and additional offices without replacing original dates", () => {
    const [raw] = ATS_ADAPTERS.personio.parseListing(personio(position));
    expect(ATS_ADAPTERS.personio.normalize(raw, "example")).toMatchObject({
      id: "personio:example:00123", company: "Example Inc", usEligibility: "us", jobType: "Full-time",
      postedAt: "2026-10-20T12:00:00.000Z", sourceUrl: "https://example.jobs.personio.com/job/00123?language=en",
    });
  });
  it("decodes standard XML entities and tolerates formatted feed whitespace", () => {
    const [raw] = parsePersonioXml(personio(`\n  ${position.replace("Software Engineer", "R&amp;D Engineer")}\n`));
    expect(ATS_ADAPTERS.personio.normalize(raw, "example").title).toBe("R&D Engineer");
  });
  it("accepts a well-formed empty Personio snapshot", () => {
    expect(parsePersonioXml("<workzag-jobs/>" )).toEqual([]);
    expect(parsePersonioXml(personio(""))).toEqual([]);
    expect(parsePersonioXml(personio("\n  "))).toEqual([]);
  });
  it.each([
    "<html><body>Upstream error</body></html>", "<workzag-jobs><position></workzag-jobs>",
    "<!DOCTYPE workzag-jobs [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><workzag-jobs>&x;</workzag-jobs>",
    "<workzag-jobs><error>Forbidden</error></workzag-jobs>",
    "<workzag-jobs><position><id>1</id></position></workzag-jobs>",
  ])("rejects corrupt, unexpected or entity-bearing XML", (xml) => {
    expect(() => parsePersonioXml(xml)).toThrow();
  });
  it("preserves Recruitee publication, update, expiry and secondary US location", () => {
    const [raw] = ATS_ADAPTERS.recruitee.parseListing({ offers: [recruitee] });
    expect(ATS_ADAPTERS.recruitee.normalize(raw, "example")).toMatchObject({
      company: "Example Inc", usEligibility: "us", postedAt: "2026-10-20T12:30:00.000Z",
      sourceUpdatedAt: "2026-10-21T13:00:00.000Z", sourceExpiresAt: "2026-11-01T00:00:00.000Z",
      applyUrl: recruitee.careers_apply_url, sourceUrl: recruitee.careers_url,
    });
  });
  it("keeps missing source dates unknown", () => {
    expect(ATS_ADAPTERS.recruitee.normalize({ ...recruitee, published_at: null }, "example").postedAt).toBeNull();
    expect(ATS_ADAPTERS.smartrecruiters.normalize({ ...smart, releasedDate: null }, "example").postedAt).toBeNull();
  });
  it("rejects a non-public Recruitee record", () => {
    expect(() => ATS_ADAPTERS.recruitee.parseListing({ offers: [{ ...recruitee, status: "draft" }] })).toThrow();
  });
  it("rejects duplicate IDs for every complete snapshot", () => {
    expect(() => ATS_ADAPTERS.smartrecruiters.parseListing({ jobs: [smart, smart] })).toThrow(/Duplicate/);
    expect(() => ATS_ADAPTERS.workable.parseListing({ name: "Example", jobs: [workable, { ...workable, title: "Conflicting title" }] })).toThrow(/Conflicting/);
    expect(() => ATS_ADAPTERS.recruitee.parseListing({ offers: [recruitee, recruitee] })).toThrow(/Duplicate/);
    expect(() => parsePersonioXml(personio(position + position))).toThrow(/Duplicate/);
  });
});
