import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { SalarySchema } from "./contract";
import { salaryFromText } from "./extract";
import { countryFromField } from "./location";
import { htmlToText } from "./text";

export const REMOTEFIRSTJOBS_ORIGIN = "https://remotefirstjobs.com";
export const remotefirstjobsTenant = z.literal("public");
export const remotefirstjobsId = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[1-9][0-9]*$/)
  .refine(value => value === value.trim(), "Invalid Remote First Jobs ID whitespace");

export function remotefirstjobsUrl(value: string, id: string) {
  remotefirstjobsId.parse(id);
  // Check raw bytes as well as identity: no encoded path, userinfo, port, query,
  // fragment or normalization of a provider-supplied application URL.
  if (!new RegExp(`^https://remotefirstjobs\\.com/companies/[a-z0-9]+(?:-[a-z0-9]+)*/jobs/${id}$`).test(value) || !value.endsWith(`/${id}`))
    throw new Error("Invalid Remote First Jobs posting URL");
  return value;
}

export const RemoteFirstJobsPosting = z.object({
  id: remotefirstjobsId, url: z.string().max(2000),
  title: z.string().trim().min(1).max(250), company_name: z.string().trim().min(1).max(250),
  description: z.string().max(500_000), locations: z.array(z.string().trim().max(120)).max(3),
  category: z.string().max(120).nullish(),
  // Validate the reported value, but never promote aggregator publication into
  // the employer's original date. The live API emits timezone-less timestamps.
  published_at: z.iso.datetime({ local: true, offset: true }).nullable(),
}).superRefine((job, ctx) => {
  try { remotefirstjobsUrl(job.url, job.id); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid Remote First Jobs URL or identity" }); }
});

export const RemoteFirstJobsListing = z.array(RemoteFirstJobsPosting).max(500).superRefine((jobs, ctx) => {
  if (new Set(jobs.map(job => job.id)).size !== jobs.length)
    ctx.addIssue({ code: "custom", message: "Duplicate Remote First Jobs identity" });
});
export const RemoteFirstJobsPage = z.object({
  page: z.number().int().min(0).max(4), jobs_count: z.number().int().min(0).max(100),
  jobs: z.array(RemoteFirstJobsPosting).max(100),
}).superRefine((page, ctx) => {
  if (page.jobs_count !== page.jobs.length)
    ctx.addIssue({ code: "custom", message: "Remote First Jobs page count mismatch" });
});

/** Own-site display with per-job credit; no onward submission to third-party job sites. */
export const remotefirstjobs: SourceAdapter = {
  source: "remotefirstjobs",
  listUrl(tenant) {
    remotefirstjobsTenant.parse(tenant);
    return `${REMOTEFIRSTJOBS_ORIGIN}/api/search-jobs?category=software-development&page=0`;
  },
  parseListing: body => RemoteFirstJobsListing.parse(body),
  postingId: raw => RemoteFirstJobsPosting.parse(raw).id,
  attribution(tenant, job) {
    remotefirstjobsTenant.parse(tenant);
    if (!job || job.source !== "remotefirstjobs" || job.tenant !== tenant)
      throw new Error("Remote First Jobs requires per-job attribution");
    return { name: "Remote First Jobs", url: remotefirstjobsUrl(job.sourceUrl, job.sourceJobId) };
  },
  normalize(raw, tenant) {
    remotefirstjobsTenant.parse(tenant);
    const job = RemoteFirstJobsPosting.parse(raw);
    const url = remotefirstjobsUrl(job.url, job.id), descriptionText = htmlToText(job.description);
    const locations = job.locations.map(raw => {
      const detected = countryFromField(raw);
      // The API promises country names. Require a whole US name/code rather
      // than interpreting broad remote regions or client/employer prose as US.
      const country = detected === "US" && !/^(?:United States(?: of America)?|US|USA)$/i.test(raw) ? null : detected;
      return { raw, country, city: null, region: null, remote: true };
    });
    const extractedSalary = salaryFromText(descriptionText);
    const salary = extractedSalary && SalarySchema.safeParse(extractedSalary.salary).success ? extractedSalary : null;
    return buildJob({ source: "remotefirstjobs", tenant, sourceJobId: job.id, requisitionKey: null,
      title: job.title, company: job.company_name, department: job.category ?? null,
      descriptionText, sourceUrl: url, applyUrl: url, rawLocation: job.locations.join("; "), locations,
      workMode: { value: "Remote", evidence: { field: "workMode", value: "Remote", method: "structured",
        quote: "Remote First Jobs remote jobs API", sourceField: "api" } },
      jobType: null, salary,
      postedAt: null, sourceUpdatedAt: null,
    });
  },
};
