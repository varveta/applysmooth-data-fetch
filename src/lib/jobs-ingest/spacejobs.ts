import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { SalarySchema } from "./contract";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { countryFromField, parseLocationText } from "./location";
import { UnverifiedPostingError } from "./normalization-error";
import { htmlToText, toIso } from "./text";

export const SPACEJOBS_FEED_URL = "https://spacejobs.now/feeds/jobs.xml?country=us&page=1";
export const spacejobsTenant = z.literal("public");
const short = z.string().trim().max(1000);
const date = z.string().trim().max(100).refine(value => !value || toIso(value) !== null, "Invalid SpaceJobs date").optional();
const countryList = z.string().trim().max(2000).refine(value => !value || /^[A-Z]{2}(?:\s*,\s*[A-Z]{2})*$/.test(value), "Invalid SpaceJobs eligibility countries").optional();
const Posting = z.object({
  referencenumber: z.string().regex(/^[a-f0-9]{12}$/), url: z.string().url().max(2000),
  title: z.string().trim().max(250).default(""), company: z.string().trim().max(250).default(""),
  description: z.string().max(500_000).default(""), city: short.optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(),
  location: short.optional(), remotetype: short.optional(), jobtype: short.optional(), category: short.optional(),
  eligibility: z.enum(["one-country", "several-countries", "most-countries", "worldwide"]),
  eligiblecountries: countryList, excludedcountries: countryList,
  talentpool: z.enum(["yes", "no"]).optional(), date, updated: date, expirationdate: z.iso.date().optional(),
}).superRefine((job, ctx) => {
  try { spacejobsUrl(job.url, job.referencenumber); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid SpaceJobs posting URL or identity" }); }
});
export const SpacejobsPosting = Posting;

export function spacejobsUrl(value: string, id: string) {
  // Validate raw bytes, not URL-normalized input: all observed US-feed URLs use
  // this exact query. Reject encoded paths, explicit default ports and variants.
  if (!/^[a-f0-9]{12}$/.test(id) || !new RegExp(
    `^https://spacejobs\\.now/jobs/[a-z0-9]+(?:-[a-z0-9]+)*-${id}\\?utm_source=job-feed&utm_medium=job-feed&utm_campaign=us$`,
  ).test(value))
    throw new Error("Invalid SpaceJobs URL");
  return value;
}

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: true,
  isArray: (_name, path) => path === "source.job" });
const count = z.coerce.number().int().min(0).max(6_000_000);
export function parseSpacejobsXml(body: unknown) {
  if (typeof body !== "string" || Buffer.byteLength(body) > 20_000_000 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body))
    throw new Error("Unsafe or oversized SpaceJobs XML");
  if (XMLValidator.validate(body) !== true) throw new Error("Malformed SpaceJobs XML");
  const { source } = z.object({ source: z.object({ publisher: z.literal("SpaceJobs.Now"),
    publisherurl: z.literal("https://spacejobs.now"), market: z.literal("US"),
    totaljobs: count, page: z.coerce.number().int().min(1), pages: z.coerce.number().int().min(1).max(10_000),
    job: z.array(Posting).max(600).default([]),
  }) }).parse(parser.parse(body));
  if (source.page !== 1 || source.pages !== Math.max(1, Math.ceil(source.totaljobs / 600)) ||
      source.job.length !== Math.min(600, source.totaljobs))
    throw new Error("SpaceJobs page metadata or count mismatch");
  if (new Set(source.job.map(job => job.referencenumber)).size !== source.job.length)
    throw new Error("Duplicate SpaceJobs posting identity");
  return { jobs: source.job, total: source.totaljobs, pages: source.pages };
}

const codes = (value?: string) => value ? value.split(",").map(code => code.trim()) : [];
export const spacejobs: SourceAdapter = {
  source: "spacejobs", listUrl: tenant => { spacejobsTenant.parse(tenant); return SPACEJOBS_FEED_URL; },
  attribution(tenant, job) {
    spacejobsTenant.parse(tenant);
    if (!job || job.source !== "spacejobs" || job.tenant !== tenant) throw new Error("SpaceJobs requires job attribution");
    return { name: "SpaceJobs.Now", url: spacejobsUrl(job.sourceUrl, job.sourceJobId) };
  },
  postingId: raw => Posting.parse(raw).referencenumber,
  parseListing: body => z.array(Posting).max(600).parse(body),
  normalize(raw, tenant) {
    spacejobsTenant.parse(tenant);
    const job = Posting.parse(raw), included = codes(job.eligiblecountries), excluded = codes(job.excludedcountries);
    if (job.talentpool === "yes") throw new UnverifiedPostingError("Employer lists a talent pool without a current vacancy");
    const restricted = ["one-country", "several-countries"].includes(job.eligibility);
    if (excluded.includes("US") || (restricted && !included.length) ||
        (job.country === "US" && restricted && !included.includes("US")) || included.some(code => excluded.includes(code)))
      throw new UnverifiedPostingError("SpaceJobs eligibility is missing, excluded or contradictory");
    const remote = /^(?:remote|fully.remote)$/i.test(job.remotetype ?? "");
    const rawLocation = job.location || [job.city, job.country].filter(Boolean).join(", ");
    const locations = parseLocationText(rawLocation).map(location => {
      const country = countryFromField(job.country);
      if (country && location.country && country !== location.country)
        throw new UnverifiedPostingError("SpaceJobs country conflicts with its location");
      return { ...location, country: country ?? location.country, remote: remote || location.remote };
    });
    // Explicit remote hiring reach may differ from the employer's physical office.
    if (remote && !locations.some(location => location.country === "US") &&
        (included.includes("US") || (!restricted && !excluded.includes("US"))))
      locations.push({ raw: `Remote eligibility: ${job.eligibility}; included=${included.join(",")}; excluded=${excluded.join(",")}`,
        city: null, region: null, country: "US", remote: true });
    const descriptionText = htmlToText(job.description), url = spacejobsUrl(job.url, job.referencenumber);
    const extractedSalary = salaryFromText(descriptionText);
    // Some original listings contain a placeholder "$0.00 - $0.00". Keep their
    // original text, but do not publish a numeric salary that violates the contract.
    const salary = extractedSalary && SalarySchema.safeParse(extractedSalary.salary).success ? extractedSalary : null;
    return buildJob({ source: "spacejobs", tenant, sourceJobId: job.referencenumber,
      requisitionKey: null, title: job.title, company: job.company, department: job.category || null,
      descriptionText, sourceUrl: url, applyUrl: url, rawLocation, locations,
      workMode: remote ? { value: "Remote", evidence: { field: "workMode", value: "Remote", quote: job.remotetype!,
        method: "structured", sourceField: "remotetype" } } : workModeFromStructured(job.remotetype, "remotetype"),
      jobType: jobTypeFromStructured(job.jobtype?.replaceAll("_", " "), "jobtype"), salary,
      // The publisher mixes original dates with first-seen dates without a flag.
      postedAt: null, sourceUpdatedAt: toIso(job.updated), sourceExpiresAt: toIso(job.expirationdate),
    });
  },
};
