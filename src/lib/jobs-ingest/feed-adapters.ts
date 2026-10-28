import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob, type DraftJob } from "./build";
import { NormalizedJobSchema, type JobLocation, type Salary } from "./contract";
import { formatSalaryText, jobTypeFromStructured, periodFromInterval, plausibleSalary, salaryFromText, workModeFromStructured } from "./extract";
import { countryFromField, parseLocationText } from "./location";
import { cleanText, htmlToText, quote, sha256, toIso } from "./text";

const id = z.union([z.string().min(1), z.number().int().nonnegative()]).transform(String)
  .pipe(NormalizedJobSchema.shape.sourceJobId).refine((value) => value.trim().length > 0);
const count = z.number().int().nonnegative().max(10_000_000);
const nonempty = z.string().refine((value) => value.trim().length > 0);
const timestamp = z.number().finite().nonnegative().max(253_402_300_799);
const money = z.number().finite().nonnegative().nullish();

function providerUrl(host: string) {
  return z.string().url().max(2000).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password && !url.port;
  }, `Expected an HTTPS ${host} URL`);
}

function unique<T>(jobs: T[], key: (job: T) => string): T[] {
  const seen = new Set<string>();
  for (const job of jobs) {
    const value = key(job);
    if (seen.has(value)) throw new Error(`Duplicate feed posting ID: ${value}`);
    seen.add(value);
  }
  return jobs;
}

/** URL identifiers exceed the contract's 120-character limit; hash the full stable guid. */
const guidId = (guid: string) => `guid-${sha256(guid)}`;
const location = (raw: string, country: string | null): JobLocation => ({
  raw: cleanText(raw).slice(0, 250), city: null, region: null, country, remote: true,
});

function remoteLocations(raw: string): JobLocation[] {
  const text = cleanText(raw);
  if (/\b(?:except|excluding|outside|not(?: in)?)\s+(?:the\s+)?(?:US|USA|United States)\b/i.test(text))
    return [location(text, "ZZ")];
  if (/^(?:worldwide|anywhere(?: in the world)?|global)$/i.test(text))
    return [location(text, "US")];
  // Working US hours is not permission to reside in the US.
  const geography = text.replace(/\b(?:USA?|United States)\s+(?:time\s*zones?|hours)\b/gi, "");
  return parseLocationText(geography).map((value) => ({ ...value, raw: value.raw.slice(0, 250), remote: true }));
}

function structuredSalary(min: number | null | undefined, max: number | null | undefined,
  currency: string | null | undefined, interval: string | null | undefined, sourceField: string): DraftJob["salary"] {
  if (!(min || max)) return null;
  const salary: Salary = {
    min: min && min > 0 ? min : null, max: max && max > 0 ? max : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    period: periodFromInterval(interval), text: "",
  };
  salary.text = formatSalaryText(salary.min, salary.max, salary.currency, salary.period);
  return plausibleSalary(salary) ? { salary, evidence: {
    field: "salary", value: salary.text, quote: quote(JSON.stringify({ min, max, currency, interval })),
    method: "structured", sourceField,
  } } : null;
}

function draft(source: DraftJob["source"], tenant: string, sourceJobId: string,
  title: string, company: string, description: string, url: string, rawLocation: string): DraftJob {
  const descriptionText = htmlToText(description);
  return { source, tenant, sourceJobId, title, company, descriptionText, applyUrl: url, sourceUrl: url,
    requisitionKey: null, department: null, rawLocation, locations: remoteLocations(rawLocation),
    workMode: workModeFromStructured("Remote", "feed.remote"), jobType: null,
    salary: salaryFromText(descriptionText), postedAt: null, sourceUpdatedAt: null };
}

const JobicyJob = z.object({
  id, url: providerUrl("jobicy.com"), jobTitle: nonempty, companyName: nonempty,
  jobDescription: z.string(), jobGeo: z.string(), jobType: z.array(z.string()).optional(),
  pubDate: z.string().optional(), salaryMin: money, salaryMax: money,
  salaryCurrency: z.string().nullish(), salaryPeriod: z.string().nullish(),
});
const JobicyPage = z.object({
  jobs: z.array(JobicyJob), jobCount: count, nextCursor: z.string().min(1).max(4096).nullable(),
  hasMore: z.boolean(), success: z.literal(true), statusCode: z.literal(200),
}).superRefine((page, ctx) => {
  if (page.jobCount !== page.jobs.length || page.hasMore !== (page.nextCursor !== null) || (page.hasMore && !page.jobs.length))
    ctx.addIssue({ code: "custom", message: "Inconsistent Jobicy page count or cursor" });
});
export const jobicy: SourceAdapter = {
  source: "jobicy", listUrl: () => "https://jobicy.com/api/jobs?count=200&geo=usa",
  attribution: () => ({ name: "Jobicy", url: "https://jobicy.com" }),
  postingId: (raw) => JobicyJob.parse(raw).id,
  parseListing: (body) => unique(JobicyPage.parse(body).jobs, (job) => job.id),
  normalize(raw, tenant) {
    const job = JobicyJob.parse(raw);
    return buildJob({ ...draft("jobicy", tenant, job.id, job.jobTitle, job.companyName, job.jobDescription, job.url, job.jobGeo),
      jobType: jobTypeFromStructured(job.jobType?.[0], "jobType"), postedAt: toIso(job.pubDate),
      salary: structuredSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod, "salary") ?? salaryFromText(htmlToText(job.jobDescription)),
    });
  },
};

const HimalayasJob = z.object({
  guid: providerUrl("himalayas.app"), applicationLink: providerUrl("himalayas.app"),
  title: nonempty, companyName: nonempty, description: z.string(),
  locationRestrictions: z.array(z.string()).max(300), timezoneRestrictions: z.array(z.number().finite().min(-12).max(14)).max(100),
  employmentType: z.string().nullish(), pubDate: timestamp.nullish(), expiryDate: timestamp,
  minSalary: money, maxSalary: money, currency: z.string().nullish(), salaryPeriod: z.string().nullish(),
});
const HimalayasPage = z.object({ jobs: z.array(HimalayasJob), totalCount: count,
  offset: count.optional(), limit: count.optional(), nextCursor: z.string().min(1).max(4096).nullish(),
}).superRefine((page, ctx) => {
  if (page.totalCount < page.jobs.length)
    ctx.addIssue({ code: "custom", message: "Himalayas total smaller than returned jobs" });
});
export const himalayas: SourceAdapter = {
  source: "himalayas", listUrl: () => "https://himalayas.app/jobs/api/search?country=US&sort=recent&page=1",
  attribution: () => ({ name: "Himalayas", url: "https://himalayas.app" }),
  postingId: (raw) => guidId(HimalayasJob.parse(raw).guid),
  parseListing: (body) => unique(HimalayasPage.parse(body).jobs, (job) => job.guid),
  normalize(raw, tenant) {
    const job = HimalayasJob.parse(raw);
    const countries = job.locationRestrictions;
    const permitsUs = !countries.length || countries.some((value) => countryFromField(value) === "US");
    const compatibleTimezone = job.timezoneRestrictions.some((value) => [-10, -9, -8, -7, -6, -5].includes(value));
    const rawLocation = countries.length ? countries.join("; ") : "Worldwide";
    // Missing/incompatible timezone evidence cannot be converted into country eligibility.
    const locations = permitsUs && !compatibleTimezone ? [location(`${rawLocation}; timezone eligibility unconfirmed`, null)]
      : countries.length ? countries.map((value) => location(value, countryFromField(value))) : [location("Worldwide", "US")];
    return buildJob({ ...draft("himalayas", tenant, guidId(job.guid), job.title, job.companyName, job.description, job.applicationLink, rawLocation),
      sourceUrl: job.guid, locations, jobType: jobTypeFromStructured(job.employmentType, "employmentType"),
      // Himalayas documents pubDate as last updated, not the original publication date.
      postedAt: null, sourceUpdatedAt: job.pubDate == null ? null : toIso(job.pubDate * 1000),
      sourceExpiresAt: toIso(job.expiryDate * 1000),
      salary: structuredSalary(job.minSalary, job.maxSalary, job.currency, job.salaryPeriod, "salary") ?? salaryFromText(htmlToText(job.description)),
    });
  },
};

const RemoteOkJob = z.object({ id, position: nonempty, company: nonempty, description: z.string(),
  url: providerUrl("remoteok.com"), apply_url: providerUrl("remoteok.com").optional(),
  location: z.string().optional(), date: z.string().optional(), epoch: timestamp.optional(), salary_min: money, salary_max: money,
});
export const remoteok: SourceAdapter = {
  source: "remoteok", listUrl: () => "https://remoteok.com/api",
  attribution: () => ({ name: "Remote OK", url: "https://remoteok.com" }),
  postingId: (raw) => RemoteOkJob.parse(raw).id,
  parseListing(body) {
    const items = z.array(z.unknown()).min(1).parse(body);
    z.object({ legal: nonempty, last_updated: timestamp }).parse(items[0]);
    return unique(items.slice(1).map((value) => RemoteOkJob.parse(value)), (job) => job.id);
  },
  normalize(raw, tenant) {
    const job = RemoteOkJob.parse(raw);
    return buildJob({ ...draft("remoteok", tenant, job.id, job.position, job.company, job.description, job.apply_url || job.url, job.location ?? ""),
      sourceUrl: job.url, postedAt: toIso(job.date) ?? (job.epoch == null ? null : toIso(job.epoch * 1000)),
      // Remote OK does not identify a salary currency or interval in these fields.
      salary: structuredSalary(job.salary_min, job.salary_max, null, null, "salary_min/salary_max") ?? salaryFromText(htmlToText(job.description)),
    });
  },
};

const RemotiveJob = z.object({ id, title: nonempty, company_name: nonempty, description: z.string(),
  url: providerUrl("remotive.com"), candidate_required_location: z.string(), job_type: z.string().optional(),
  publication_date: z.string().optional(), salary: z.string().nullish(),
});
const RemotivePage = z.object({ jobs: z.array(RemotiveJob), "job-count": count, "total-job-count": count.optional() })
  .superRefine((page, ctx) => {
    if (page["job-count"] !== page.jobs.length || (page["total-job-count"] != null && page["total-job-count"] < page.jobs.length))
      ctx.addIssue({ code: "custom", message: "Inconsistent Remotive counts" });
  });
export const remotive: SourceAdapter = {
  source: "remotive", listUrl: () => "https://remotive.com/api/remote-jobs",
  attribution: () => ({ name: "Remotive", url: "https://remotive.com" }),
  postingId: (raw) => RemotiveJob.parse(raw).id,
  parseListing: (body) => unique(RemotivePage.parse(body).jobs, (job) => job.id),
  normalize(raw, tenant) {
    const job = RemotiveJob.parse(raw);
    return buildJob({ ...draft("remotive", tenant, job.id, job.title, job.company_name, job.description, job.url, job.candidate_required_location),
      jobType: jobTypeFromStructured(job.job_type, "job_type"), postedAt: toIso(job.publication_date),
      salary: salaryFromText(job.salary ?? "") ?? salaryFromText(htmlToText(job.description)),
    });
  },
};

const WwrJob = z.object({ title: nonempty, description: z.string(), link: providerUrl("weworkremotely.com"),
  guid: providerUrl("weworkremotely.com"), region: z.string().optional(), country: z.string().optional(),
  state: z.string().optional(), type: z.string().optional(), pubDate: z.string().optional(), expires_at: nonempty,
}).refine((job) => toIso(job.expires_at) !== null, "Invalid WWR expiry date");
const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true,
  isArray: (_name, path) => path === "rss.channel.item" });

export const weworkremotely: SourceAdapter = {
  source: "weworkremotely", listUrl: () => "https://weworkremotely.com/remote-jobs.rss",
  attribution: () => ({ name: "We Work Remotely", url: "https://weworkremotely.com" }),
  postingId: (raw) => guidId(WwrJob.parse(raw).guid),
  parseListing(body) {
    if (typeof body !== "string" || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) throw new Error("Unsafe or invalid WWR XML");
    if (XMLValidator.validate(body) !== true) throw new Error("Malformed WWR XML");
    const parsed = z.object({ rss: z.object({ channel: z.object({ title: nonempty, link: z.string(), item: z.array(WwrJob).optional() }) }) })
      .parse(xmlParser.parse(body));
    return unique(parsed.rss.channel.item ?? [], (job) => job.guid);
  },
  normalize(raw, tenant) {
    const job = WwrJob.parse(raw);
    const split = job.title.indexOf(":");
    if (split < 1 || !job.title.slice(split + 1).trim()) throw new Error("WWR title must identify employer and role");
    // WWR may label region as Worldwide while restricting country to Canada, etc.
    const rawLocation = cleanText(job.country) || cleanText(job.region);
    const values = draft("weworkremotely", tenant, guidId(job.guid), job.title.slice(split + 1), job.title.slice(0, split), job.description, job.link, rawLocation);
    return buildJob({ ...values, sourceUrl: job.guid, jobType: jobTypeFromStructured(job.type, "type"),
      postedAt: toIso(job.pubDate), sourceExpiresAt: toIso(job.expires_at),
    });
  },
};

export const FEED_ADAPTERS = { jobicy, himalayas, weworkremotely, remoteok, remotive } satisfies Partial<Record<DraftJob["source"], SourceAdapter>>;
