import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { salaryFromText, workModeFromStructured } from "./extract";
import { countryFromField } from "./location";
import { htmlToText, toIso } from "./text";

export const teamtailorTenant = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).toLowerCase();
const optionalText = z.string().trim().max(250).optional();
const location = z.object({
  "tt:name": optionalText,
  "tt:city": z.string().trim().max(120).optional(),
  "tt:country": z.string().trim().max(120).optional(),
});
const FeedItem = z.object({
  guid, title: z.string().trim().min(1).max(250),
  description: z.string().min(1).max(250_000),
  pubDate: z.string().trim().max(100).refine(value => !value || toIso(value) !== null, "Invalid publication date").optional(),
  link: z.string().url().max(2000), remoteStatus: optionalText,
  "tt:department": optionalText,
  "tt:locations": z.union([
    z.literal(""), z.object({ "tt:location": z.array(location).max(100).optional() }),
  ]).optional(),
});
export const TeamtailorPosting = FeedItem.extend({
  tenant: teamtailorTenant, company: z.string().trim().min(1).max(250),
});

export function teamtailorUrl(value: string, tenant: string): string {
  teamtailorTenant.parse(tenant);
  const url = new URL(value);
  if (url.origin !== `https://${tenant}.teamtailor.com` || url.username || url.password ||
      url.port || url.search || url.hash || !/^\/jobs\/[1-9]\d{0,19}-[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname))
    throw new Error("Invalid Teamtailor posting URL");
  return url.href;
}

const parser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: true,
  isArray: (_name, path) => typeof path === "string" && ["rss.channel.item", "rss.channel.item.tt:locations.tt:location"].includes(path),
});
/** Only standard XML escapes are decoded; DTDs and custom entities are prohibited. */
export function parseTeamtailorXml(body: unknown, tenant: string) {
  teamtailorTenant.parse(tenant);
  if (typeof body !== "string" || Buffer.byteLength(body) > 12_000_000)
    throw new Error("Invalid Teamtailor XML body");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) throw new Error("Unsafe Teamtailor XML declarations");
  if (XMLValidator.validate(body) !== true) throw new Error("Malformed Teamtailor XML");
  const { rss } = z.object({ rss: z.object({
    "@_version": z.literal("2.0"),
    "@_xmlns:tt": z.literal("https://teamtailor.com/locations"),
    channel: z.object({
      title: z.string().trim().min(1).max(250), link: z.string().url(),
      item: z.array(FeedItem).max(100).optional(),
    }),
  }) }).parse(parser.parse(body));
  const channel = rss.channel;
  if (![ `https://${tenant}.teamtailor.com/jobs`, `https://${tenant}.teamtailor.com/jobs/` ].includes(channel.link))
    throw new Error("Teamtailor channel does not match tenant");
  const ids = new Set<string>(), urls = new Set<string>();
  const jobs = (channel.item ?? []).map(item => {
    const url = teamtailorUrl(item.link, tenant);
    const numericId = new URL(url).pathname.split("/")[2].split("-")[0];
    if (ids.has(item.guid) || urls.has(numericId)) throw new Error("Duplicate Teamtailor identity");
    ids.add(item.guid); urls.add(numericId);
    return TeamtailorPosting.parse({ ...item, tenant, company: channel.title });
  });
  return { company: channel.title, jobs };
}

export const teamtailor: SourceAdapter = {
  source: "teamtailor",
  listUrl(tenant) {
    teamtailorTenant.parse(tenant);
    return `https://${tenant}.teamtailor.com/jobs.rss?offset=0&per_page=100`;
  },
  attribution(tenant, job) {
    teamtailorTenant.parse(tenant);
    return { name: "Teamtailor", url: job ? teamtailorUrl(job.sourceUrl, tenant) : `https://${tenant}.teamtailor.com/jobs` };
  },
  postingId: raw => TeamtailorPosting.parse(raw).guid,
  parseListing: body => z.array(TeamtailorPosting).max(1000).parse(body),
  normalize(raw, tenant) {
    teamtailorTenant.parse(tenant);
    const job = TeamtailorPosting.parse(raw);
    if (job.tenant !== tenant) throw new Error("Teamtailor posting does not match tenant");
    const url = teamtailorUrl(job.link, tenant);
    const descriptionText = htmlToText(job.description);
    const workMode = workModeFromStructured(job.remoteStatus === "hybrid" ? "hybrid" :
      job.remoteStatus === "fully" ? "remote" : job.remoteStatus === "none" ? "onsite" : null, "remoteStatus");
    const places = job["tt:locations"];
    const locations = (places && places["tt:location"] || []).map(place => ({
      raw: [place["tt:city"], place["tt:country"]].filter(Boolean).join(", ") || place["tt:name"] || "Unknown",
      city: place["tt:city"] || null, region: null,
      // Office/client mentions in job prose and generic remote status are not eligibility evidence.
      country: countryFromField(place["tt:country"]), remote: workMode?.value === "Remote",
    }));
    return buildJob({
      source: "teamtailor", tenant, sourceJobId: job.guid, requisitionKey: null,
      title: job.title, company: job.company, department: job["tt:department"] || null,
      descriptionText, sourceUrl: url, applyUrl: url, locations,
      rawLocation: locations.map(place => place.raw).join("; "), workMode,
      jobType: null, salary: salaryFromText(descriptionText),
      postedAt: toIso(job.pubDate), sourceUpdatedAt: null,
    });
  },
};
