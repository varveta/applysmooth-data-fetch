import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, toIso } from "./text";

const text = z.string().max(100_000);
const optionalText = text.nullish();
const tenantSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const deadline = z.iso.datetime({ offset: true }).nullish();
const posting = z.object({
  id: z.string().min(1).max(120).regex(/^\S+$/), title: z.string().trim().min(1).max(250),
  url: z.string().url().max(2000), description: text, key_responsibilities: optionalText,
  skills_knowledge_expertise: optionalText, benefits: optionalText, deadline_at: deadline,
  employment_type: optionalText, workplace_type: optionalText,
  compensation_visible: z.boolean().optional(), compensation: optionalText,
  location: z.object({ name: optionalText, city: optionalText, province: optionalText, country: optionalText }).nullish(),
  job: z.object({ requisition_id: optionalText, department: z.object({ name: optionalText }).nullish() }).nullish(),
});
const envelope = z.object({ data: z.array(posting).max(10_000) });
function host(tenant: string) { return `${tenantSchema.parse(tenant)}.pinpointhq.com`; }
function boardUrl(value: string, tenant: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== host(tenant) || url.username || url.password || url.port)
    throw new Error("Invalid Pinpoint posting URL");
  return url.href;
}

/** Experimental TEST-only adapter. Public feed access does not imply redistribution permission. */
export const pinpoint: SourceAdapter = {
  source: "pinpoint",
  listUrl: tenant => `https://${host(tenant)}/postings.json`,
  attribution: tenant => ({ name: "Pinpoint", url: `https://${host(tenant)}` }),
  postingId: raw => posting.parse(raw).id,
  parseListing(body) {
    const jobs = envelope.parse(body).data;
    if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("Duplicate Pinpoint posting ID");
    return jobs;
  },
  normalize(raw, tenant, companyName) {
    const job = posting.parse(raw);
    const company = z.string().trim().min(1).max(250).parse(companyName);
    const url = boardUrl(job.url, tenant);
    const descriptionText = [job.description, job.key_responsibilities, job.skills_knowledge_expertise, job.benefits]
      .filter((part): part is string => typeof part === "string" && part.length > 0).map(htmlToText).join("\n");
    // Prefer structured city/province over decorated display names, without guessing a country.
    const location = job.location;
    const rawLocation = location?.city || location?.province || location?.country
      ? [location.city, location.province, location.country].filter(Boolean).join(", ") : location?.name ?? "";
    return buildJob({ source: "pinpoint", tenant, sourceJobId: job.id, title: job.title, company,
      requisitionKey: job.job?.requisition_id ?? null, department: job.job?.department?.name ?? null,
      descriptionText, sourceUrl: url, applyUrl: url, rawLocation, locations: parseLocationText(rawLocation),
      workMode: workModeFromStructured(job.workplace_type, "workplace_type"),
      jobType: jobTypeFromStructured(job.employment_type?.replaceAll("_", " "), "employment_type"),
      salary: salaryFromText(job.compensation_visible ? job.compensation ?? descriptionText : descriptionText),
      postedAt: null, sourceUpdatedAt: null, sourceExpiresAt: toIso(job.deadline_at),
    });
  },
};
