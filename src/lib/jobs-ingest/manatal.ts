import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, toIso } from "./text";

export const manatalTenant = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const text = z.string().max(100_000);
export const ManatalPosting = z.object({
  id: z.number().int().positive().safe(), hash: z.string().regex(/^[A-Z0-9]{1,40}$/),
  position_name: z.string().trim().min(1).max(250), description: text,
  country: text.nullish(), state: text.nullish(), city: text.nullish(), location_display: text.nullish(),
  is_remote: z.boolean().nullish(), contract_details: text.nullish(),
  // Public listing responses often omit these; never substitute observation time.
  created_at: z.iso.datetime({ offset: true }).nullish(),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
});
export const ManatalPage = z.object({ count: z.number().int().min(0).max(10_000),
  next: z.string().url().nullable(), previous: z.string().url().nullable(),
  results: z.array(ManatalPosting).max(100) });
export const manatal: SourceAdapter = {
  source: "manatal",
  listUrl: tenant => `https://api.manatal.com/open/v3/career-page/${manatalTenant.parse(tenant)}/jobs/?page=1&page_size=100`,
  attribution: tenant => ({ name: "Manatal", url: `https://www.careers-page.com/${manatalTenant.parse(tenant)}` }),
  postingId: raw => String(ManatalPosting.parse(raw).id),
  parseListing: body => z.array(ManatalPosting).max(10_000).parse(body),
  normalize(raw, tenant, companyName) {
    const j = ManatalPosting.parse(raw);
    const company = z.string().trim().min(1).max(250).parse(companyName);
    const url = `https://www.careers-page.com/${manatalTenant.parse(tenant)}/job/${j.hash}`;
    const rawLocation = [j.city, j.state, j.country].filter(Boolean).join(", ") || j.location_display || "";
    const descriptionText = htmlToText(j.description);
    return buildJob({ source: "manatal", tenant, sourceJobId: String(j.id), title: j.position_name,
      company, requisitionKey: null, department: null, descriptionText,
      sourceUrl: url, applyUrl: url, rawLocation,
      locations: parseLocationText(rawLocation).map(l => ({ ...l, remote: j.is_remote ?? l.remote })),
      workMode: j.is_remote === true ? workModeFromStructured("remote", "is_remote") : null,
      jobType: jobTypeFromStructured(j.contract_details?.replaceAll("_", " "), "contract_details"),
      salary: salaryFromText(descriptionText), postedAt: toIso(j.created_at), sourceUpdatedAt: toIso(j.updated_at),
    });
  },
};
