import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { salaryFromText, workModeFromStructured } from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, toIso } from "./text";

export const getonboardTenant = z.literal("public");
const text = z.string().max(250_000);
const heading = z.string().max(500).nullish();
export const GetonboardPosting = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  type: z.literal("job"),
  attributes: z.object({
    title: z.string().trim().min(1).max(250),
    description: text,
    description_headline: heading,
    projects: text,
    functions: text,
    functions_headline: heading,
    benefits: text,
    benefits_headline: heading,
    desirable: text,
    desirable_headline: heading,
    countries: z.array(z.string().trim().min(1).max(120)).max(100),
    remote: z.boolean(),
    remote_modality: z.string().max(80).nullish(),
    published_at: z.number().int().nonnegative().max(253402300799).nullable(),
    company: z.object({
      data: z.object({
        id: z.string().min(1).max(120),
        type: z.literal("company"),
        attributes: z.object({ name: z.string().trim().min(1).max(250) }),
      }),
    }),
  }),
  links: z.object({ public_url: z.string().url().max(2000) }),
});
export const GetonboardPage = z.object({
  data: z.array(GetonboardPosting).max(100),
  meta: z.object({
    page: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100),
    total_pages: z.number().int().nonnegative().max(100_000),
  }),
});
export function getonboardUrl(value: string, id: string) {
  const url = new URL(value);
  if (url.origin !== "https://www.getonbrd.com" || url.username || url.password ||
      url.port || url.search || url.hash || ![`/jobs/${id}`, `/jobs/${id}/`].includes(url.pathname))
    throw new Error("Invalid Get on Board posting URL");
  return url.href;
}
export const getonboard: SourceAdapter = {
  source: "getonboard",
  listUrl(tenant) {
    getonboardTenant.parse(tenant);
    return "https://www.getonbrd.com/api/v0/search/jobs?query=United%20States&page=1&per_page=10&expand%5B%5D=company";
  },
  attribution(tenant, job) {
    getonboardTenant.parse(tenant);
    return { name: "Get on Board", url: job ? getonboardUrl(job.sourceUrl, job.sourceJobId) : "https://www.getonbrd.com" };
  },
  postingId: raw => GetonboardPosting.parse(raw).id,
  parseListing: body => z.array(GetonboardPosting).max(250).parse(body),
  normalize(raw, tenant) {
    getonboardTenant.parse(tenant);
    const j = GetonboardPosting.parse(raw), a = j.attributes;
    const url = getonboardUrl(j.links.public_url, j.id);
    // All job-specific sections are retained. Company-profile content is not a
    // substitute for a job description and is intentionally not concatenated.
    const descriptionText = [
      [a.description_headline, a.description],
      [null, a.projects],
      [a.functions_headline, a.functions],
      [a.desirable_headline, a.desirable],
      [a.benefits_headline, a.benefits],
    ].map(([name, content]) => [name ? htmlToText(name) : "", htmlToText(content ?? "")].filter(Boolean).join("\n"))
      .filter(Boolean).join("\n\n");
    const rawLocation = a.countries.join("; ");
    const workMode = workModeFromStructured(a.remote_modality === "hybrid" ? "hybrid" :
      ["fully_remote", "remote_local"].includes(a.remote_modality ?? "") || a.remote ? "remote" :
      a.remote_modality === "no_remote" ? "onsite" : null, "remote_modality");
    return buildJob({
      source: "getonboard", tenant, sourceJobId: j.id,
      title: a.title, company: a.company.data.attributes.name,
      requisitionKey: null, department: null, sourceUrl: url, applyUrl: url,
      descriptionText, rawLocation,
      // A US employer, a US client, or the search query does not imply US eligibility.
      locations: a.countries.flatMap(country => parseLocationText(country)).map(location => ({
        ...location, remote: workMode?.value === "Remote" || location.remote,
      })),
      workMode, jobType: null, salary: salaryFromText(descriptionText),
      postedAt: a.published_at === null ? null : toIso(a.published_at * 1000),
      sourceUpdatedAt: null,
    });
  },
};
