import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { jobTypeFromStructured, salaryFromText, workModeFromStructured } from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, toIso } from "./text";

// Public /json route identified in openroles (MIT); see THIRD_PARTY_NOTICES.md.
const text = z.string().max(100_000);
const location = z.object({ name: text.nullish(), city: text.nullish(),
  country: z.object({ id: text.nullish(), name: text.nullish() }).nullish(),
  state: z.object({ name: text.nullish() }).nullish(), is_remote: z.boolean().optional() });
export const BreezyPosting = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), name: text.min(1), url: z.string().url(),
  published_date: text.nullish(), updated_date: text.nullish(), department: text.nullish(),
  type: z.object({ name: text }).nullish(), location: location.nullish(), locations: z.array(location).optional(),
  description: text.optional(), detail_posted_at: text.nullish(), detail_expires_at: text.nullish(),
});
export function breezyHost(tenant: string) {
  return `${z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).parse(tenant)}.breezy.hr`;
}
export function breezyUrl(value: string, tenant: string, id: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.hostname !== breezyHost(tenant) || u.port || u.username || u.password ||
      !(u.pathname === `/p/${id}` || u.pathname.startsWith(`/p/${id}-`)))
    throw new Error("Invalid Breezy posting URL");
  u.search = ""; u.hash = "";
  return u.href;
}
export function parseBreezyList(body: unknown) {
  const jobs = z.array(BreezyPosting).max(500).parse(body);
  if (new Set(jobs.map(j => j.id)).size !== jobs.length) throw new Error("Duplicate Breezy posting ID");
  return jobs;
}
export const breezy: SourceAdapter = {
  source: "breezy", listUrl: tenant => `https://${breezyHost(tenant)}/json`,
  attribution: tenant => ({ name: "Breezy HR", url: `https://${breezyHost(tenant)}` }),
  postingId: raw => BreezyPosting.parse(raw).id,
  parseListing: parseBreezyList,
  normalize(raw, tenant, companyName) {
    const j = BreezyPosting.parse(raw);
    const company = z.string().trim().min(1).max(250).parse(companyName);
    const url = breezyUrl(j.url, tenant, j.id);
    const locs = j.locations?.length ? j.locations : j.location ? [j.location] : [];
    const locations = locs.flatMap(l => {
      const label = [l.city, l.state?.name, l.country?.name ?? l.country?.id].filter(Boolean).join(", ") || l.name || "";
      return parseLocationText(label).map(parsed => ({ ...parsed, remote: l.is_remote ?? parsed.remote }));
    });
    const rawLocation = locations.map(l => l.raw).join("; ");
    const descriptionText = htmlToText(j.description ?? "");
    return buildJob({ source: "breezy", tenant, sourceJobId: j.id, title: j.name, company,
      requisitionKey: null, department: j.department ?? null, sourceUrl: url, applyUrl: url,
      descriptionText, locations, rawLocation,
      workMode: locs.length && locs.every(l => l.is_remote === true)
        ? workModeFromStructured("remote", "locations.is_remote") : null,
      jobType: jobTypeFromStructured(j.type?.name, "type.name"), salary: salaryFromText(descriptionText),
      // Preserve original page date; never turn today's observation into a publication date.
      postedAt: toIso(j.detail_posted_at ?? j.published_date), sourceUpdatedAt: toIso(j.updated_date),
      sourceExpiresAt: toIso(j.detail_expires_at),
    });
  },
};
