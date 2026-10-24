import {
  CatalogRowSchema,
  type CatalogRow,
  type NormalizedJob,
} from "./contract";
import { dedupeLocations, formatLocations } from "./location";
import { sha256 } from "./text";

/**
 * Public catalog ID. Opaque on purpose: the internal posting ID names the provider and
 * tenant (`greenhouse:stripe:123`), which must not be readable by app users.
 */
export const publicJobId = (postingId: string) =>
  `job_${sha256(`posting:${postingId}`).slice(0, 32)}`;

/**
 * Build the `public.job_catalog` row for a canonical posting. Duplicate members
 * (same requisition in other locations) contribute locations only; the row keeps
 * the canonical posting's ID, URLs and text.
 */
export function toCatalogRow(
  job: NormalizedJob,
  opts: {
    firstSeenAt: string;
    duplicates: NormalizedJob[];
    attribution: { name: string; url: string };
  },
): CatalogRow {
  const locations = dedupeLocations([
    ...job.locations,
    ...opts.duplicates.flatMap((d) => d.locations),
  ]);
  const locationText = opts.duplicates.length
    ? formatLocations(locations, job.locationText)
    : job.locationText;
  const row = {
    id: publicJobId(job.id),
    source: job.source,
    source_tenant: job.tenant,
    source_job_id: job.sourceJobId,
    source_url: job.sourceUrl,
    apply_url: job.applyUrl,
    attribution_name: opts.attribution.name,
    attribution_url: opts.attribution.url,
    title: job.title,
    company: job.company,
    department: job.department,
    description: job.descriptionText,
    location_text: locationText,
    locations,
    work_mode: job.workMode,
    job_type: job.jobType,
    experience: job.experience,
    salary_min: job.salary?.min ?? null,
    salary_max: job.salary?.max ?? null,
    salary_currency: job.salary?.currency ?? null,
    salary_period: job.salary?.period ?? null,
    salary_text: job.salary?.text || null,
    visas: job.visas,
    visa_sponsorship: job.visaSponsorship,
    employment: job.employment,
    employment_excluded: job.employmentExcluded,
    eligibility_evidence: job.evidence,
    requirements: job.requirements,
    posted_at: job.postedAt,
    first_seen_at: opts.firstSeenAt,
    source_updated_at: job.sourceUpdatedAt,
    content_hash: "",
    duplicate_posting_ids: opts.duplicates.map((d) => d.id).sort(),
  };
  // The published hash covers merged locations too, so a new sibling location republishes.
  row.content_hash = sha256({
    job: job.contentHash,
    locations,
    dup: row.duplicate_posting_ids,
  });
  return CatalogRowSchema.parse(row);
}
