import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { countryFromField, parseLocationText } from "./location";
import { htmlToText, toIso } from "./text";
import { UnverifiedPostingError } from "./normalization-error";

export const YUBHUB_FEED_URL = "https://feeds.yubhub.co/facet/country/united-states.json";
export const yubhubTenant = z.literal("public");
const text = z.string().max(500_000);
const originalDate = z.preprocess(
  value => typeof value === "string" && !value.trim() ? null : value,
  z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullish(),
);
export const YubhubDiscovery = z.object({
  "@type": z.literal("JobPosting"),
  identifier: z.object({ name: z.literal("YubHub"), value: z.string().regex(/^job_[a-zA-Z0-9-]{1,100}$/) }),
  title: z.string().trim().min(1).max(250),
  url: z.string().url(),
  "x-apply-url": z.string().url(),
});
export const YubhubFeed = z.object({
  "x-feed-size-limit": z.literal(100),
  "x-facet": z.object({ type: z.literal("country"), slug: z.literal("united-states"), count: z.number().int().min(0).max(100) }),
  jobs: z.array(YubhubDiscovery).max(100),
}).refine(feed => feed["x-facet"].count === feed.jobs.length, "YubHub feed count mismatch");

const address = z.object({
  addressLocality: z.string().max(250).nullish(),
  addressRegion: z.string().max(250).nullish(),
  addressCountry: z.union([z.string().max(250), z.object({ name: z.string().max(250) })]).nullish(),
});
const place = z.object({ address });
export const WorkdayPosting = z.object({
  "@type": z.literal("JobPosting"),
  identifier: z.object({ value: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/) }),
  title: z.string().trim().max(250).nullish().transform(value => value ?? ""),
  description: text.nullish().transform(value => value ?? ""),
  hiringOrganization: z.object({ name: z.string().trim().max(250).nullish().transform(value => value ?? "") }).nullish().transform(value => value ?? { name: "" }),
  datePosted: originalDate,
  validThrough: originalDate,
  employmentType: z.union([z.string().max(120), z.array(z.string().max(120)).max(20)]).nullish(),
  jobLocation: z.union([place, z.array(place).max(100)]).nullish(),
  jobLocationType: z.string().max(120).nullish(),
});
export const YubhubPosting = YubhubDiscovery.extend({
  original: WorkdayPosting.nullable(),
  hydration_error: z.enum(["missing_original", "detail_unavailable"]).optional(),
}).superRefine((item, ctx) => {
  try {
    const url = yubhubEmployerUrl(item.url);
    if (yubhubEmployerUrl(item["x-apply-url"]) !== url) throw new Error("Application URL mismatch");
    if ((item.original === null) !== (item.hydration_error !== undefined)) throw new Error("Invalid hydration state");
    if (item.original) {
      const id = item.original.identifier.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const slug = decodeURIComponent(new URL(url).pathname.split("/").at(-1)!);
      if (!new RegExp(`_${id}(?:-\\d+)?$`).test(slug)) throw new Error("Original identity mismatch");
    }
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid YubHub posting identity or hydration state" });
  }
});

/** Only normal employer Workday job pages; no credentials, queries or redirect targets. */
export function yubhubEmployerUrl(value: string) {
  const u = new URL(value);
  const segments = u.pathname.split("/").filter(Boolean);
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash ||
      !/^[a-z0-9][a-z0-9-]{0,61}\.wd[0-9]+\.myworkdayjobs\.com$/.test(u.hostname) ||
      segments.length !== 5 || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(segments[0]) ||
      segments[2] !== "job" || segments.some(s => /[\\/]/.test(decodeURIComponent(s)) || [".", ".."].includes(decodeURIComponent(s))))
    throw new Error("Unsupported YubHub employer job URL");
  return u.href;
}

export function hydrateYubhubPosting(raw: unknown, html: string) {
  const item = YubhubDiscovery.parse(raw);
  const url = yubhubEmployerUrl(item.url);
  if (yubhubEmployerUrl(item["x-apply-url"]) !== url) throw new Error("YubHub application URL mismatch");
  const postings: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node["@type"] === "JobPosting") postings.push(node);
    if (Array.isArray(node["@graph"])) node["@graph"].forEach(visit);
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi))
    visit(JSON.parse(match[1]));
  if (postings.length === 0) return YubhubPosting.parse({ ...item, original: null, hydration_error: "missing_original" });
  if (postings.length !== 1) throw new Error("Conflicting original Workday JobPosting");
  const original = WorkdayPosting.parse(postings[0]);
  return YubhubPosting.parse({ ...item, original });
}

export const yubhub: SourceAdapter = {
  source: "yubhub",
  listUrl: tenant => { yubhubTenant.parse(tenant); return YUBHUB_FEED_URL; },
  attribution: tenant => { yubhubTenant.parse(tenant); return { name: "Data by YubHub", url: "https://yubhub.co" }; },
  postingId: raw => YubhubPosting.parse(raw).identifier.value,
  parseListing: body => z.array(YubhubPosting).max(100).parse(body),
  normalize(raw, tenant) {
    yubhubTenant.parse(tenant);
    const j = YubhubPosting.parse(raw), original = j.original;
    if (!original) throw new UnverifiedPostingError("Original employer posting unavailable");
    const url = yubhubEmployerUrl(j.url);
    if (yubhubEmployerUrl(j["x-apply-url"]) !== url) throw new Error("YubHub application URL mismatch");
    const entries = original.jobLocation ? Array.isArray(original.jobLocation) ? original.jobLocation : [original.jobLocation] : [];
    const remote = original.jobLocationType === "TELECOMMUTE";
    const locations = entries.flatMap(({ address: a }) => {
      const countryText = typeof a.addressCountry === "object" ? a.addressCountry?.name : a.addressCountry;
      const rawLocation = [a.addressLocality, a.addressRegion, countryText].filter(Boolean).join(", ");
      return parseLocationText(rawLocation).map(location => ({ ...location,
        country: countryFromField(countryText) ?? location.country,
        remote: remote || location.remote,
      }));
    });
    const descriptionText = htmlToText(original.description);
    return buildJob({
      source: "yubhub", tenant, sourceJobId: j.identifier.value,
      title: original.title, company: original.hiringOrganization.name,
      requisitionKey: original.identifier.value, department: null,
      sourceUrl: url, applyUrl: url, descriptionText, locations,
      rawLocation: locations.map(l => l.raw).join("; "),
      workMode: remote ? workModeFromStructured("remote", "original.jobLocationType") : null,
      jobType: jobTypeFromStructured((Array.isArray(original.employmentType) ? original.employmentType[0] : original.employmentType)?.replaceAll("_", " "), "original.employmentType"),
      salary: salaryFromText(descriptionText), postedAt: toIso(original.datePosted),
      sourceUpdatedAt: null, sourceExpiresAt: toIso(original.validThrough),
    });
  },
};
