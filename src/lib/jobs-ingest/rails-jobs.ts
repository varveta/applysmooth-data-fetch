import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { salaryFromText, workModeFromText } from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, sha256, toIso } from "./text";

export const RAILS_JOBS_ORIGIN = "https://jobs.rubyonrails.org";
export const railsJobsTenant = z.literal("public");
export const RAILS_JOBS_MAX_ITEMS = 1000;

export function railsJobsUrl(value: string): string {
  if (!/^https:\/\/jobs\.rubyonrails\.org\/jobs\/[1-9]\d{0,19}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error("Invalid Rails Job Board posting URL");
  return value;
}

const FeedItem = z.object({
  title: z.string().trim().min(1).max(505),
  description: z.string().min(1).max(250_000),
  pubDate: z.string().trim().min(1).max(100)
    .refine(value => toIso(value) !== null, "Invalid Rails publication date"),
  link: z.string().max(2000), guid: z.string().max(2000),
}).superRefine((item, ctx) => {
  if (item.guid !== item.link) ctx.addIssue({ code: "custom", message: "Rails GUID must match posting link" });
  try { railsJobsUrl(item.link); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid Rails posting link" }); }
});
export const RailsJobsPosting = FeedItem;

const parser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: true,
  isArray: (_name, path) => path === "rss.channel.item",
});

/** Feed XML is the only content source; never follows links to employer pages. */
export function parseRailsJobsXml(body: unknown) {
  if (typeof body !== "string" || Buffer.byteLength(body) > 12_000_000)
    throw new Error("Invalid Rails RSS body");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) throw new Error("Unsafe Rails XML declaration");
  if (XMLValidator.validate(body) !== true) throw new Error("Malformed Rails RSS");
  const { rss } = z.object({ rss: z.object({
    "@_version": z.literal("2.0"),
    channel: z.object({
      title: z.literal("Rails Job Board"), link: z.literal(`${RAILS_JOBS_ORIGIN}/`),
      item: z.array(FeedItem).max(RAILS_JOBS_MAX_ITEMS).optional(),
    }),
  }) }).parse(parser.parse(body));
  const jobs = rss.channel.item ?? [];
  const ids = new Set<string>();
  for (const job of jobs) {
    const id = postingId(job);
    if (ids.has(id)) throw new Error("Duplicate Rails posting identity");
    ids.add(id);
  }
  return jobs;
}

function postingId(item: z.infer<typeof FeedItem>): string {
  return railsJobsUrl(item.guid).slice(`${RAILS_JOBS_ORIGIN}/jobs/`.length).split("-")[0];
}

/** Accept only explicit role-location statements, never company/HQ/client prose. */
function statedJobLocation(description: string): string {
  const lines = description.split("\n").map(line => line.trim().replace(/^[-•]\s*/, "").replace(/’/g, "'"));
  const mentionsUs = (line: string) => /\bunited states(?: of america)?\b|\bu\.s\.(?:a\.?)?/i.test(line) ||
    /(?:^|[^A-Za-z])(?:US|USA)(?=$|[^A-Za-z])/.test(line);
  // A separate eligibility restriction can contradict a positive location label.
  // Quarantine that conflict; do not silently discard the negative statement.
  if (lines.some(line => mentionsUs(line) &&
      /\b(?:not|no|cannot|can't|unable|except|exclud(?:e|ed|es|ing)|outside|ineligible)\b/i.test(line) &&
      /\b(?:applicants?|applications?|candidates?|hir(?:e|ed|es|ing)|eligib\w*|resid\w*|locat\w*|based|open|available|accept\w*|consider\w*|apply)\b/i.test(line))) return "";
  const places: string[] = [];
  for (const line of lines) {
    if (/\b(?:not|except|excluding|outside|unable|cannot|can't)\b/i.test(line)) continue;
    const label = /^Location:\s*(.+)$/i.exec(line)?.[1];
    const candidates = /^This is a remote opportunity and is open to candidates in (.+)$/i.exec(line)?.[1];
    const based = /\b(?:This|The) (?:role|position) is (?:fully )?remote \(based in ([^)]+)\)/i.exec(line)?.[1];
    const remote = /^(?:Fully )?remote based in (.+)$/i.exec(line)?.[1];
    const value = label?.replace(/,?\s*reporting to\b.*$/i, "") ??
      (candidates || based || remote ? `Remote, ${candidates || based || remote}` : null);
    // Clock alignment is not a hiring jurisdiction, even under a Location label.
    if (value && value.length <= 250 && !/\b(?:hours?|time[ -]?zones?|overlap|UTC|GMT|[ECMP][DS]T)\b/i.test(value)) places.push(value);
  }
  // Conflicting or verbose location declarations require review, not guessed eligibility.
  const unique = [...new Set(places)];
  return unique.length === 1 ? unique[0] : "";
}

export const railsjobs: SourceAdapter = {
  source: "railsjobs",
  listUrl(tenant) { railsJobsTenant.parse(tenant); return `${RAILS_JOBS_ORIGIN}/jobs.rss`; },
  attribution(tenant, job) {
    railsJobsTenant.parse(tenant);
    return { name: "Rails Job Board", url: job ? railsJobsUrl(job.sourceUrl) : `${RAILS_JOBS_ORIGIN}/` };
  },
  postingId: raw => postingId(FeedItem.parse(raw)),
  parseListing: body => z.array(FeedItem).max(RAILS_JOBS_MAX_ITEMS).parse(body),
  normalize(raw, tenant) {
    railsJobsTenant.parse(tenant);
    const item = FeedItem.parse(raw);
    // JobKit's RSS combines job title and company; split only the final delimiter.
    const separator = item.title.lastIndexOf(" at ");
    if (separator < 1 || separator + 4 === item.title.length) throw new Error("Rails RSS title lacks employer");
    const title = item.title.slice(0, separator), company = item.title.slice(separator + 4);
    if (title.length > 250 || company.length > 250) throw new Error("Rails RSS title or employer is too long");
    const descriptionText = htmlToText(item.description);
    const rawLocation = statedJobLocation(descriptionText);
    const job = buildJob({
      source: "railsjobs", tenant, sourceJobId: postingId(item), requisitionKey: null,
      title, company, department: null, descriptionText,
      sourceUrl: item.link, applyUrl: item.link,
      locations: parseLocationText(rawLocation), rawLocation,
      workMode: workModeFromText(rawLocation, "description"), jobType: null,
      salary: salaryFromText(descriptionText), postedAt: toIso(item.pubDate), sourceUpdatedAt: null,
    });
    const evidence = job.evidence.map(item => item.field === "usEligibility"
      ? { ...item, method: "text-pattern" as const, sourceField: "description" } : item);
    return { ...job, evidence, contentHash: sha256({ normalizedHash: job.contentHash, evidence }) };
  },
};
