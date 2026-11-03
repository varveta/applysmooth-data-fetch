import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import {
  jobTypeFromStructured,
  salaryFromText,
  workModeFromStructured,
} from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, toIso } from "./text";
export const trakstarTenant = z.string().regex(/^[a-z0-9][a-z0-9-]{0,61}$/);
const text = z.string().max(100_000);
export const TrakstarPosting = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  title: z.string().trim().min(1).max(250),
  description: text,
  client_name: trakstarTenant,
  hosted_url: z.string().url(),
  location: z
    .object({
      city: text.nullish(),
      state: text.nullish(),
      country: text.nullish(),
    })
    .nullish(),
  allows_remote: z.boolean().optional(),
  position_type: text.nullish(),
  team: text.nullish(),
  detail_posted_at: z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .nullish(),
  detail_expires_at: z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .nullish(),
  close_date: z.number().int().nonnegative().max(253402300799).nullish(),
});
export const TrakstarPage = z.object({
  objects: z.array(TrakstarPosting).max(100),
  meta: z
    .object({
      offset: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(100),
      total: z.number().int().nonnegative().max(10_000).optional(),
      total_count: z.number().int().nonnegative().max(10_000).optional(),
    })
    .refine(
      (m) =>
        (m.total !== undefined || m.total_count !== undefined) &&
        (m.total === undefined ||
          m.total_count === undefined ||
          m.total === m.total_count),
      "Missing or conflicting total",
    ),
});
export function trakstarUrl(value: string, tenant: string, id: string) {
  const t = trakstarTenant.parse(tenant),
    u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    ![`${t}.hire.trakstar.com`, `${t}.recruiterbox.com`].includes(u.hostname) ||
    ![`/jobs/${id}`, `/jobs/${id}/`].includes(u.pathname)
  )
    throw new Error("Invalid Trakstar posting URL");
  return u.href;
}
export const trakstar: SourceAdapter = {
  source: "trakstar",
  listUrl: (t) =>
    `https://jsapi.recruiterbox.com/v1/openings?client_name=${trakstarTenant.parse(t)}&offset=0&limit=20`,
  attribution: (t) => ({
    name: "Trakstar Hire",
    url: `https://${trakstarTenant.parse(t)}.hire.trakstar.com`,
  }),
  postingId: (r) => TrakstarPosting.parse(r).id,
  parseListing: (body) => z.array(TrakstarPosting).max(10_000).parse(body),
  normalize(raw, tenant, companyName) {
    const j = TrakstarPosting.parse(raw);
    if (j.client_name !== tenant) throw new Error("Trakstar employer mismatch");
    const company = z.string().trim().min(1).max(250).parse(companyName);
    const url = trakstarUrl(j.hosted_url, tenant, j.id),
      descriptionText = htmlToText(j.description);
    const rawLocation = [
      j.location?.city,
      j.location?.state,
      j.location?.country,
    ]
      .filter(Boolean)
      .join(", ");
    return buildJob({
      source: "trakstar",
      tenant,
      sourceJobId: j.id,
      title: j.title,
      company,
      requisitionKey: null,
      department: j.team ?? null,
      sourceUrl: url,
      applyUrl: url,
      descriptionText,
      rawLocation,
      locations: parseLocationText(rawLocation).map((l) => ({
        ...l,
        remote: j.allows_remote ?? l.remote,
      })),
      workMode: j.allows_remote
        ? workModeFromStructured("remote", "allows_remote")
        : null,
      jobType: jobTypeFromStructured(
        j.position_type?.replaceAll("_", " "),
        "position_type",
      ),
      salary: salaryFromText(descriptionText),
      postedAt: toIso(j.detail_posted_at),
      sourceUpdatedAt: null,
      sourceExpiresAt: j.detail_expires_at
        ? toIso(j.detail_expires_at)
        : j.close_date == null
          ? null
          : toIso(j.close_date * 1000),
    });
  },
};
