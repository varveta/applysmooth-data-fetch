import { z } from "zod";
import type { SourceAdapter } from "./adapters";
import { buildJob } from "./build";
import { salaryFromText, workModeFromStructured } from "./extract";
import { parseLocationText } from "./location";
import { htmlToText, isSafeHttpsUrl, toIso } from "./text";

export const REMOTE_BACKEND_ORIGIN = "https://www.remotebackendjobs.com";
export const remoteBackendTenant = z.literal("public");
export const remoteBackendId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullish();
const employerUrl = z.string().max(2000).refine((value) => {
  if (!isSafeHttpsUrl(value) || !/^https:\/\/[^/?#@:]+(?:[/?#]|$)/.test(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password && !url.port &&
    /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z][a-zA-Z0-9-]*$/.test(url.hostname) &&
    !/\.(?:localhost|local|internal)$/i.test(url.hostname);
}, "Unsafe employer application URL");
// Explicit fields only: the public endpoint also exposes incidental account/payment
// metadata that is neither needed nor retained by collection.
export const RemoteBackendSummary = z.object({
  id: remoteBackendId,
  title: z.string().trim().min(1).max(250),
  location: z.string().max(1000).nullish(),
  link: employerUrl,
  isoDate: date,
});
export const RemoteBackendPosting = RemoteBackendSummary.extend({
  content: z.string().min(1).max(500_000),
  company: z.object({ name: z.string().trim().min(1).max(250) }),
  updatedAt: date,
  archivedAt: date,
  reviewPending: z.boolean(),
});
export function remoteBackendJobUrl(id: string) {
  return `${REMOTE_BACKEND_ORIGIN}/${remoteBackendId.parse(id)}`;
}

export const remotebackendjobs: SourceAdapter = {
  source: "remotebackendjobs",
  listUrl(tenant) {
    remoteBackendTenant.parse(tenant);
    return `${REMOTE_BACKEND_ORIGIN}/api/jobs?regions=north-america&limit=50&offset=0`;
  },
  parseListing: (body) => z.array(RemoteBackendPosting).max(250).parse(body),
  postingId: (raw) => RemoteBackendPosting.parse(raw).id,
  attribution(tenant, job) {
    remoteBackendTenant.parse(tenant);
    if (!job || job.source !== "remotebackendjobs" || job.tenant !== tenant)
      throw new Error("Remote Backend Jobs requires per-job attribution");
    return { name: "Remote Backend Jobs", url: remoteBackendJobUrl(job.sourceJobId) };
  },
  normalize(raw, tenant) {
    remoteBackendTenant.parse(tenant);
    const j = RemoteBackendPosting.parse(raw);
    if (j.reviewPending) throw new Error("Unreviewed Remote Backend Jobs posting");
    const descriptionText = htmlToText(j.content);
    const rawLocation = j.location ?? "";
    return buildJob({
      source: "remotebackendjobs", tenant, sourceJobId: j.id, requisitionKey: null,
      title: j.title, company: j.company.name, department: null,
      sourceUrl: remoteBackendJobUrl(j.id), applyUrl: j.link, descriptionText,
      rawLocation, locations: parseLocationText(rawLocation),
      workMode: /\bremote\b/i.test(rawLocation) ? workModeFromStructured("remote", "location") : null,
      jobType: null, salary: salaryFromText(descriptionText),
      // createdAt is the aggregator's discovery time, never an original posting date.
      postedAt: toIso(j.isoDate), sourceUpdatedAt: toIso(j.updatedAt),
      sourceExpiresAt: toIso(j.archivedAt),
    });
  },
};
