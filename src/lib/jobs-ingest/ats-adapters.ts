import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { NormalizedJobSchema, type JobLocation } from "./contract";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { countryFromField, parseLocationText } from "./location";
import { cleanText, htmlToText, toIso } from "./text";

const id = z.union([z.string(), z.number().int().safe()]).transform(String)
  .pipe(NormalizedJobSchema.shape.sourceJobId)
  .refine((value) => value.trim().length > 0, "Posting ID must not be blank");
const text = z.string();
const optionalText = text.nullish();
const title = text.min(1).refine((value) => value.trim().length > 0);
const httpsUrl = z.string().url().refine((value) => {
  const u = new URL(value);
  return u.protocol === "https:" && !u.username && !u.password;
}, "Expected an HTTPS URL without credentials");
const label = z.object({ label: optionalText }).nullish();

/** Reject duplicate identities before reconciliation can infer anything is absent. */
function snapshot<T>(jobs: T[], identity: (job: T) => string): T[] {
  const seen = new Set<string>();
  for (const job of jobs) {
    const key = identity(job);
    if (seen.has(key)) throw new Error(`Duplicate posting ID: ${key}`);
    seen.add(key);
  }
  return jobs;
}

function structuredLocation(
  city: string | null | undefined,
  region: string | null | undefined,
  country: string | null | undefined,
  remote = false,
  raw?: string | null,
): JobLocation[] {
  const countryCode = countryFromField(country?.length === 2 ? country.toUpperCase() : country);
  const value = cleanText(raw) || [city, region, country].filter(Boolean).join(", ");
  if (countryCode) return [{
    raw: value.slice(0, 250), city: cleanText(city).slice(0, 120) || null,
    region: cleanText(region).slice(0, 120) || null, country: countryCode, remote,
  }];
  return parseLocationText(value).map((location) => ({ ...location, remote: remote || location.remote }));
}

const SmartLocation = z.object({
  city: optionalText, region: optionalText, country: optionalText,
  fullLocation: optionalText, remote: z.boolean().nullish(), hybrid: z.boolean().nullish(),
});
const Section = z.object({ title: optionalText, text });
export const SmartRecruitersJobSchema = z.object({
  id, name: title, company: z.object({ name: title, identifier: optionalText }),
  location: SmartLocation, releasedDate: optionalText,
  postingUrl: httpsUrl, applyUrl: httpsUrl, active: z.literal(true), visibility: z.literal("PUBLIC"),
  refNumber: optionalText, department: label, typeOfEmployment: label,
  jobAd: z.object({ sections: z.object({
    companyDescription: Section.nullish(), jobDescription: Section,
    qualifications: Section.nullish(), additionalInformation: Section.nullish(),
  }) }),
});

const smartrecruiters: SourceAdapter = {
  source: "smartrecruiters",
  listUrl: (tenant) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(tenant)}/postings?limit=100&offset=0&destination=PUBLIC`,
  parseListing: (body) => snapshot(z.object({ jobs: z.array(SmartRecruitersJobSchema) }).parse(body).jobs, (job) => job.id),
  postingId: (raw) => id.parse(z.object({ id: z.unknown() }).parse(raw).id),
  attribution: (tenant) => ({ name: "SmartRecruiters job board", url: `https://careers.smartrecruiters.com/${encodeURIComponent(tenant)}` }),
  normalize(raw, tenant) {
    const j = SmartRecruitersJobSchema.parse(raw);
    const locations = structuredLocation(j.location.city, j.location.region, j.location.country, j.location.remote ?? false, j.location.fullLocation);
    const descriptionText = Object.values(j.jobAd.sections).filter((section) => section != null)
      .map((section) => [cleanText(section.title), htmlToText(section.text)].filter(Boolean).join("\n")).join("\n\n");
    return buildJob({
      source: "smartrecruiters", tenant, sourceJobId: j.id, requisitionKey: j.refNumber ?? null,
      title: j.name, company: j.company.name, department: j.department?.label ?? null,
      descriptionText, applyUrl: j.applyUrl, sourceUrl: j.postingUrl, locations,
      rawLocation: locations.map((location) => location.raw).join("; "),
      workMode: workModeFromStructured(j.location.hybrid ? "hybrid" : j.location.remote ? "remote" : null, "location"),
      jobType: jobTypeFromStructured(j.typeOfEmployment?.label, "typeOfEmployment.label"),
      salary: salaryFromText(descriptionText), postedAt: toIso(j.releasedDate), sourceUpdatedAt: null,
    });
  },
};

const WorkableLocation = z.object({
  country: optionalText, countryCode: optionalText, city: optionalText, region: optionalText,
});
const WorkableJob = z.object({
  shortcode: id, title, description: text, url: httpsUrl, shortlink: httpsUrl.nullish(), application_url: httpsUrl,
  code: optionalText, department: optionalText, employment_type: optionalText,
  telecommuting: z.boolean().nullish(), published_on: optionalText, created_at: optionalText,
  country: optionalText, city: optionalText, state: optionalText, locations: z.array(WorkableLocation).nullish(),
});
const workable: SourceAdapter = {
  source: "workable",
  listUrl: (tenant) => `https://www.workable.com/api/accounts/${encodeURIComponent(tenant)}?details=true`,
  parseListing(body) {
    const envelope = z.object({ name: title, jobs: z.array(WorkableJob) }).parse(body);
    // Workable repeats one shortcode once per location on some multi-country boards.
    // Merge only location variants; conflicting job content is not a trusted snapshot.
    const jobs = new Map<string, z.infer<typeof WorkableJob>>();
    const content = ({ locations: _locations, country: _country, city: _city, state: _state, ...job }: z.infer<typeof WorkableJob>) => JSON.stringify(job);
    const places = (job: z.infer<typeof WorkableJob>) => job.locations?.length
      ? job.locations : [{ city: job.city, region: job.state, country: job.country }];
    for (const job of envelope.jobs) {
      const prior = jobs.get(job.shortcode);
      if (!prior) jobs.set(job.shortcode, job);
      else {
        if (content(prior) !== content(job)) throw new Error(`Conflicting Workable posting ID: ${job.shortcode}`);
        jobs.set(job.shortcode, { ...prior, locations: [...places(prior), ...places(job)] });
      }
    }
    return [...jobs.values()].map((job) => ({ ...job, employerName: envelope.name }));
  },
  postingId: (raw) => id.parse(z.object({ shortcode: z.unknown() }).parse(raw).shortcode),
  attribution: (tenant) => ({ name: "Workable job board", url: `https://apply.workable.com/${encodeURIComponent(tenant)}/` }),
  normalize(raw, tenant, companyName) {
    const j = WorkableJob.extend({ employerName: title.optional() }).parse(raw);
    const places = j.locations?.length ? j.locations : [{ city: j.city, region: j.state, country: j.country }];
    const locations = places.flatMap((place) => structuredLocation(place.city, place.region, place.countryCode || place.country, j.telecommuting ?? false));
    const descriptionText = htmlToText(j.description);
    return buildJob({
      source: "workable", tenant, sourceJobId: j.shortcode, requisitionKey: j.code || null,
      title: j.title, company: j.employerName || companyName || tenant, department: j.department ?? null,
      descriptionText, applyUrl: j.application_url, sourceUrl: j.shortlink || j.url, locations,
      rawLocation: locations.map((location) => location.raw).join("; "),
      workMode: workModeFromStructured(j.telecommuting ? "remote" : null, "telecommuting"),
      jobType: jobTypeFromStructured(j.employment_type, "employment_type"), salary: salaryFromText(descriptionText),
      postedAt: toIso(j.published_on) ?? toIso(j.created_at), sourceUpdatedAt: null,
    });
  },
};

const PersonioJob = z.object({
  id, name: title, subcompany: optionalText, office: optionalText,
  additionalOffices: z.union([z.literal(""), z.object({ office: z.array(text).optional() })]).nullish(),
  department: optionalText, employmentType: optionalText, schedule: optionalText, createdAt: optionalText,
  jobDescriptions: z.object({ jobDescription: z.array(z.object({ name: optionalText, value: text })) }),
});
const xmlParser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false, trimValues: false,
  processEntities: true,
  isArray: (_name, path) => typeof path === "string" && ["workzag-jobs.position", "workzag-jobs.position.additionalOffices.office", "workzag-jobs.position.jobDescriptions.jobDescription"].includes(path),
});

/** XML declarations are allowed; DTDs and entity declarations are never interpreted. */
export function parsePersonioXml(body: unknown): z.infer<typeof PersonioJob>[] {
  if (typeof body !== "string") throw new Error("Personio snapshot must be XML text");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) throw new Error("Personio XML must not contain DTDs or entity declarations");
  const validated = XMLValidator.validate(body);
  if (validated !== true) throw new Error(`Invalid Personio XML: ${validated.err.msg}`);
  const parsed = z.object({ "workzag-jobs": z.union([
    z.string().regex(/^\s*$/), z.object({ position: z.array(PersonioJob).optional(), "#text": z.string().regex(/^\s*$/).optional() }).strict(),
  ]) }).parse(xmlParser.parse(body))["workzag-jobs"];
  return snapshot(typeof parsed === "string" ? [] : parsed.position ?? [], (job) => job.id);
}
const personio: SourceAdapter = {
  source: "personio",
  listUrl: (tenant) => `https://${encodeURIComponent(tenant)}.jobs.personio.com/xml?language=en`,
  parseListing: parsePersonioXml,
  postingId: (raw) => id.parse(z.object({ id: z.unknown() }).parse(raw).id),
  attribution: (tenant) => ({ name: "Personio job board", url: `https://${encodeURIComponent(tenant)}.jobs.personio.com/` }),
  normalize(raw, tenant, companyName) {
    const j = PersonioJob.parse(raw);
    const places = [j.office, ...(j.additionalOffices && j.additionalOffices.office || [])].filter((place): place is string => !!place);
    const descriptionText = j.jobDescriptions.jobDescription.map((section) => [cleanText(section.name), htmlToText(section.value)].filter(Boolean).join("\n")).join("\n\n");
    const sourceUrl = `https://${encodeURIComponent(tenant)}.jobs.personio.com/job/${encodeURIComponent(j.id)}?language=en`;
    return buildJob({
      source: "personio", tenant, sourceJobId: j.id, requisitionKey: null,
      title: j.name, company: cleanText(j.subcompany) || companyName || tenant, department: j.department ?? null,
      descriptionText, applyUrl: `${sourceUrl}#apply`, sourceUrl, locations: places.flatMap(parseLocationText),
      rawLocation: places.join("; "), workMode: null,
      jobType: jobTypeFromStructured(j.schedule, "schedule") ?? jobTypeFromStructured(j.employmentType, "employmentType"),
      salary: salaryFromText(descriptionText), postedAt: toIso(j.createdAt), sourceUpdatedAt: null,
    });
  },
};

const RecruiteeLocation = z.object({
  city: optionalText, state: optionalText, country: optionalText, country_code: optionalText,
});
const RecruiteeJob = z.object({
  id, title, company_name: title, status: z.literal("published"), description: text, requirements: optionalText,
  careers_url: httpsUrl, careers_apply_url: httpsUrl, location: optionalText,
  city: optionalText, state_name: optionalText, country: optionalText, country_code: optionalText,
  locations: z.array(RecruiteeLocation).nullish(), department: optionalText, employment_type_code: optionalText,
  remote: z.boolean().nullish(), hybrid: z.boolean().nullish(), on_site: z.boolean().nullish(),
  published_at: optionalText, created_at: optionalText, updated_at: optionalText, close_at: optionalText,
});
const recruiteeDate = (value: string | null | undefined) => toIso(value?.replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC$/, "$1T$2Z"));
const recruitee: SourceAdapter = {
  source: "recruitee",
  listUrl: (tenant) => `https://${encodeURIComponent(tenant)}.recruitee.com/api/offers`,
  parseListing: (body) => snapshot(z.object({ offers: z.array(RecruiteeJob) }).parse(body).offers, (job) => job.id),
  postingId: (raw) => id.parse(z.object({ id: z.unknown() }).parse(raw).id),
  attribution: (tenant) => ({ name: "Recruitee job board", url: `https://${encodeURIComponent(tenant)}.recruitee.com/` }),
  normalize(raw, tenant) {
    const j = RecruiteeJob.parse(raw);
    const places = j.locations?.length ? j.locations : [{ city: j.city, state: j.state_name, country: j.country, country_code: j.country_code }];
    const locations = places.flatMap((place) => structuredLocation(place.city, place.state, place.country_code || place.country, j.remote ?? false));
    if (!locations.length && j.location) locations.push(...parseLocationText(j.location));
    const descriptionText = [j.description, j.requirements].filter(Boolean).map((part) => htmlToText(part!)).join("\n\n");
    const jobType = j.employment_type_code?.startsWith("fulltime") ? "Full-time" : j.employment_type_code?.startsWith("parttime") ? "Part-time" : j.employment_type_code;
    // Multiple allowed workplace arrangements do not imply one universal work mode.
    const modes = [j.remote && "remote", j.hybrid && "hybrid", j.on_site && "on-site"].filter(Boolean);
    return buildJob({
      source: "recruitee", tenant, sourceJobId: j.id, requisitionKey: null, title: j.title,
      company: j.company_name, department: j.department ?? null, descriptionText,
      applyUrl: j.careers_apply_url, sourceUrl: j.careers_url, locations,
      rawLocation: locations.map((location) => location.raw).join("; "),
      workMode: workModeFromStructured(modes.length === 1 ? String(modes[0]) : null, "remote/hybrid/on_site"),
      jobType: jobTypeFromStructured(jobType, "employment_type_code"), salary: salaryFromText(descriptionText),
      postedAt: recruiteeDate(j.published_at), sourceUpdatedAt: recruiteeDate(j.updated_at),
      sourceExpiresAt: recruiteeDate(j.close_at),
    });
  },
};

export const ATS_ADAPTERS = { smartrecruiters, workable, personio, recruitee } satisfies Record<string, SourceAdapter>;
