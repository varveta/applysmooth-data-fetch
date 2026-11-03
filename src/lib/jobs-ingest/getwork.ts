import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { parseLocationText } from "./location";
import { isSafeHttpsUrl, toIso } from "./text";

export const GETWORK_ORIGIN = "https://getwork.dev";
export const getworkTenant = z.literal("public");
export const getworkId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+$/).max(120);
const date = z.iso.datetime({ offset: true }).nullable();
const employerUrl = z.string().max(2000).refine(value => {
  if (!isSafeHttpsUrl(value) || !/^https:\/\/[^/?#@:]+(?:[/?#]|$)/.test(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password && !url.port &&
    /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z][a-zA-Z0-9-]*$/.test(url.hostname) &&
    !/\.(?:localhost|local|internal)$/i.test(url.hostname);
}, "Unsafe Getwork employer URL");
export const GetworkSummary = z.object({
  id: getworkId, title: z.string().trim().min(1).max(250),
  company: z.object({ name: z.string().trim().min(1).max(250), slug: z.string().min(1).max(180) }),
  getwork_url: z.string().url().max(2000), apply_url: employerUrl.nullable(),
  published_at: date,
  location: z.string().max(2000).nullable(),
  remote: z.enum(["remote", "hybrid", "onsite", "unknown"]),
});
export const GetworkPage = z.object({
  jobs: z.array(GetworkSummary).max(50), total: z.number().int().nonnegative().max(1_000_000),
});
// Keep only public job fields. Account, agent-action and tracking metadata are ignored.
export const GetworkPosting = GetworkSummary.extend({
  active: z.boolean(), url: employerUrl,
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(100),
  untrusted_description: z.string().min(1).max(500_000),
  employment_type: z.string().max(80).nullable(),
  first_seen_at: z.iso.datetime({ offset: true }), last_seen_at: z.iso.datetime({ offset: true }),
});
export function getworkJobUrl(value: string, id: string) {
  getworkId.parse(id);
  const url = new URL(value);
  if (url.origin !== GETWORK_ORIGIN || url.username || url.password || url.port || url.search || url.hash ||
      ![`/jobs/${id}`, `/jobs/${id}/`].includes(url.pathname)) throw new Error("Invalid Getwork posting URL");
  return url.href;
}

/** TEST preparation only: public read access is documented; republication scope is unresolved. */
export const getwork: SourceAdapter = {
  source: "getwork",
  listUrl(tenant) {
    getworkTenant.parse(tenant);
    return `${GETWORK_ORIGIN}/api/jobs?country=US&days=15&limit=20&offset=0`;
  },
  parseListing: body => z.array(GetworkPosting).max(50).parse(body),
  postingId: raw => GetworkPosting.parse(raw).id,
  attribution(tenant, job) {
    getworkTenant.parse(tenant);
    if (!job || job.source !== "getwork" || job.tenant !== tenant)
      throw new Error("Getwork requires per-job attribution");
    return { name: "getwork.dev", url: getworkJobUrl(job.sourceUrl, job.sourceJobId) };
  },
  normalize(raw, tenant) {
    getworkTenant.parse(tenant);
    const job = GetworkPosting.parse(raw);
    if (!job.active) throw new Error("Inactive Getwork posting");
    const sourceUrl = getworkJobUrl(job.getwork_url, job.id);
    const rawLocation = job.location ?? "";
    const workMode = workModeFromStructured(job.remote, "remote");
    const parsed = parseLocationText(rawLocation);
    // Structured countries outrank conflicting text. Generic remote status, the US
    // query and broad regions such as North America never become US evidence.
    const locations = job.countries.length ? parsed.filter(place => place.country && job.countries.includes(place.country)) : parsed;
    for (const country of job.countries) if (!locations.some(place => place.country === country))
      locations.push({ raw: country, country, city: null, region: null, remote: workMode?.value === "Remote" });
    return buildJob({
      source: "getwork", tenant, sourceJobId: job.id, requisitionKey: null,
      title: job.title, company: job.company.name, department: null,
      // The API promises plain text; preserve it verbatim, including all final sections.
      descriptionText: job.untrusted_description, sourceUrl, applyUrl: job.apply_url ?? job.url,
      rawLocation, locations: locations.map(place => ({ ...place, remote: workMode?.value === "Remote" || place.remote })),
      workMode, jobType: jobTypeFromStructured(job.employment_type, "employment_type"),
      salary: salaryFromText(job.untrusted_description),
      postedAt: toIso(job.published_at), sourceUpdatedAt: null,
    });
  },
};
