import { expect, it, vi } from "vitest";
import { loadTeamtailorBoard } from "../../../ingest/lib/fetch-teamtailor";
import { evaluateGates } from "./gates";
import { parseTeamtailorXml, teamtailor } from "./teamtailor";

const tenant = "example-employer";
const uuid = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const description = `<h2>Responsibilities</h2><p>${"Build reliable distributed services. ".repeat(12)}</p><ul><li>Original final requirement.</li></ul>`;
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const item = (n = 1, desc = description) => `<item>
  <title>Platform Engineer</title><description>${escapeXml(desc)}</description>
  <pubDate>Thu, 29 Oct 2026 09:41:42 +0100</pubDate>
  <link>https://${tenant}.teamtailor.com/jobs/${n}-platform-engineer</link>
  <guid>${uuid(n)}</guid><remoteStatus>hybrid</remoteStatus><tt:department>Engineering</tt:department>
  <tt:locations><tt:location><tt:name>Our office</tt:name><tt:city>Boston</tt:city>
  <tt:country>United States</tt:country><tt:address>Ignored public office address</tt:address></tt:location></tt:locations>
</item>`;
const xml = (items = item(), company = "Example Employer") => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>
<title>${company}</title><description/><link>https://${tenant}.teamtailor.com/jobs</link>${items}
</channel></rss>`;
const ok = (body: unknown) => ({ ok: true as const, status: 200, body, attempts: 1, bytes: 100 });
const noWait = async () => {};
const fullPage = (offset: number) => xml(Array.from({ length: 100 }, (_, i) => item(offset + i + 1)).join(""));

it("preserves full HTML text, global GUID, employer, original time and provider links", () => {
  const raw = parseTeamtailorXml(xml(), tenant).jobs[0];
  const job = teamtailor.normalize(raw, tenant, "Ignored display label");
  expect(job).toMatchObject({ source: "teamtailor", sourceJobId: uuid(), company: "Example Employer",
    title: "Platform Engineer", department: "Engineering", workMode: "Hybrid", usEligibility: "us",
    postedAt: "2026-10-29T08:41:42.000Z", sourceUpdatedAt: null,
    sourceUrl: `https://${tenant}.teamtailor.com/jobs/1-platform-engineer`,
    applyUrl: `https://${tenant}.teamtailor.com/jobs/1-platform-engineer` });
  expect(job.descriptionText).toContain("Responsibilities");
  expect(job.descriptionText).toContain("• Original final requirement.");
  expect(job.descriptionText).not.toContain("<p>");
  expect(teamtailor.postingId(raw)).toBe(uuid());
  expect(teamtailor.attribution(tenant, job)).toEqual({ name: "Teamtailor", url: job.sourceUrl });
  expect(JSON.stringify(raw)).not.toContain("Ignored public office address");
});

it("keeps unknown geography unknown despite US clients, office names or remote status", () => {
  const feed = xml(item(1, `${description}<p>Supporting United States clients.</p>`))
    .replace("<tt:country>United States</tt:country>", "<tt:country/>")
    .replace("<remoteStatus>hybrid</remoteStatus>", "<remoteStatus>fully</remoteStatus>");
  const job = teamtailor.normalize(parseTeamtailorXml(feed, tenant).jobs[0], tenant);
  expect(job.usEligibility).toBe("unknown");
  expect(job.workMode).toBe("Remote");
  const foreign = parseTeamtailorXml(xml().replace("<tt:country>United States</tt:country>", "<tt:country>Canada</tt:country>"), tenant).jobs[0];
  expect(teamtailor.normalize(foreign, tenant).usEligibility).toBe("not_us");
});

it("preserves missing dates and oversized content for the ordinary quality gate", () => {
  const raw = parseTeamtailorXml(xml(item(1, "x".repeat(50_001))).replace(/<pubDate>[^<]+<\/pubDate>/, ""), tenant).jobs[0];
  const job = teamtailor.normalize(raw, tenant);
  expect(job.postedAt).toBeNull();
  expect(job.descriptionText).toHaveLength(50_001);
  expect(evaluateGates(job, { now: new Date("2026-11-02"), lastSeenAt: "2026-11-02T00:00:00Z", open: true, duplicateOf: null }).reasons)
    .toContain("description_too_long");
  expect(() => parseTeamtailorXml(xml().replace("Thu, 29 Oct 2026 09:41:42 +0100", "not a date"), tenant)).toThrow();
});

it("rejects malformed XML, entities, duplicate GUIDs and duplicate numeric posting IDs", () => {
  for (const feed of [
    xml().replace("</channel>", ""), "<html>not a feed</html>",
    `<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>${xml()}`,
    xml(item() + item()), xml(item() + item(2).replace(uuid(2), uuid())),
    xml(item() + item(2).replace("/jobs/2-platform-engineer", "/jobs/1-other-slug")),
    xml().replace("https://teamtailor.com/locations", "https://foreign.example/locations"),
  ]) expect(() => parseTeamtailorXml(feed, tenant)).toThrow();
});

it("rejects other tenants, redirects and unsafe posting URLs", async () => {
  for (const link of [
    "https://other.teamtailor.com/jobs/1-platform-engineer", "https://evil.example/jobs/1-platform-engineer",
    `https://${tenant}.teamtailor.com/jobs/1-platform-engineer?redirect=elsewhere`,
    `https://${tenant}.teamtailor.com/jobs/1-platform-engineer#fragment`,
    `https://user@${tenant}.teamtailor.com/jobs/1-platform-engineer`,
    `https://${tenant}.teamtailor.com:444/jobs/1-platform-engineer`,
  ]) expect(() => parseTeamtailorXml(xml().replace(`https://${tenant}.teamtailor.com/jobs/1-platform-engineer`, link), tenant)).toThrow();
  expect(() => parseTeamtailorXml(xml(), "other")).toThrow();
  expect(() => teamtailor.normalize(parseTeamtailorXml(xml(), tenant).jobs[0], "other")).toThrow();
  const get = vi.fn(async () => ok(xml()));
  await expect(loadTeamtailorBoard({ tenant: "../other" }, get, noWait)).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});

it("loads a bounded, paced observation feed with explicit HTTP safeguards", async () => {
  const wait = vi.fn(noWait);
  const get = vi.fn(async (url: string) => ok(new URL(url).searchParams.get("offset") === "0" ? fullPage(0) : xml(item(101))));
  const result = await loadTeamtailorBoard({ tenant }, get, wait);
  expect(result.body).toHaveLength(101);
  expect(result.discovery).toEqual({ policy: "observations", pages: 2, capped: false });
  expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
  expect(get).toHaveBeenNthCalledWith(2, `https://${tenant}.teamtailor.com/jobs.rss?offset=100&per_page=100`, {
    attempts: 2, timeoutMs: 20_000, maxBytes: 12_000_000, responseType: "text",
    accept: "application/rss+xml, application/xml, text/xml", redirect: "error",
  });
});

it("caps ten full pages without using missing jobs as closure evidence", async () => {
  const result = await loadTeamtailorBoard({ tenant }, async url => ok(fullPage(Number(new URL(url).searchParams.get("offset")))), noWait);
  expect(result.body).toHaveLength(1000);
  expect(result.discovery).toEqual({ policy: "observations", pages: 10, capped: true });
});

it("aborts repeated, changed, malformed or failed later pages without returning partial results", async () => {
  for (const scenario of ["duplicate", "numeric-duplicate", "changed", "malformed", "failure"] as const) {
    let calls = 0;
    await expect(loadTeamtailorBoard({ tenant }, async () => {
      if (++calls === 1) return ok(fullPage(0));
      if (scenario === "failure") return { ok: false, status: 503, error: "HTTP 503", attempts: 2, retryable: true };
      if (scenario === "duplicate") return ok(xml(item()));
      if (scenario === "numeric-duplicate") return ok(xml(item(101).replace("/jobs/101-platform-engineer", "/jobs/1-other-slug")));
      if (scenario === "changed") return ok(xml(item(101), "Different Employer"));
      return ok("<rss>truncated");
    }, noWait)).rejects.toThrow();
  }
  const empty = await loadTeamtailorBoard({ tenant }, async () => ok(xml("")), noWait);
  expect(empty.body).toEqual([]);
  expect(empty.discovery).toEqual({ policy: "observations", pages: 1, capped: false });
});
