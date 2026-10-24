import {
  NormalizedJobSchema,
  type Evidence,
  type ExperienceLevel,
  type JobLocation,
  type JobType,
  type NormalizedJob,
  type Salary,
  type SourceId,
  type WorkMode,
} from "./contract";
import {
  eligibilityFromText,
  experienceFromTitle,
  jobTypeFromTitle,
  workModeFromText,
} from "./extract";
import { dedupeLocations, formatLocations, usEligibility } from "./location";
import {
  extractRequirements,
  REQUIREMENTS_EXTRACTOR_VERSION,
} from "./requirements";
import { cleanText, sha256 } from "./text";

type Found<T> = { value: T; evidence: Evidence } | null;

export type DraftJob = {
  source: SourceId;
  tenant: string;
  sourceJobId: string;
  requisitionKey: string | null;
  title: string;
  company: string;
  department: string | null;
  descriptionText: string;
  applyUrl: string;
  sourceUrl: string;
  locations: JobLocation[];
  rawLocation: string;
  /** Adapter-provided structured values; take precedence over text patterns. */
  workMode: Found<WorkMode>;
  jobType: Found<JobType>;
  salary: { salary: Salary; evidence: Evidence } | null;
  postedAt: string | null;
  sourceUpdatedAt: string | null;
};

export const postingId = (
  source: SourceId,
  tenant: string,
  sourceJobId: string,
) => `${source}:${tenant.toLowerCase()}:${sourceJobId}`;

/** Fill shared derived fields (eligibility, evidence, hash) from an adapter draft. */
export function buildJob(d: DraftJob): NormalizedJob {
  const title = cleanText(d.title);
  const locations = dedupeLocations(d.locations);
  const evidence: Evidence[] = [];
  const pick = <T>(...found: Found<T>[]): T | null => {
    const hit = found.find((f) => f !== null) ?? null;
    if (hit) evidence.push(hit.evidence);
    return hit ? hit.value : null;
  };
  const workMode = pick(
    d.workMode,
    workModeFromText(d.rawLocation, "location"),
    workModeFromText(title, "title"),
  );
  const jobType = pick(d.jobType, jobTypeFromTitle(title));
  const experience: ExperienceLevel | null = pick(experienceFromTitle(title));
  const us = usEligibility(locations);
  if (us !== "unknown") {
    const where = locations.find((l) =>
      us === "us" ? l.country === "US" : l.country,
    );
    evidence.push({
      field: "usEligibility",
      value: us,
      quote: (where?.raw ?? d.rawLocation).slice(0, 300),
      method: "structured",
      sourceField: "location",
    });
  }
  if (d.salary) evidence.push(d.salary.evidence);
  const eligibility = eligibilityFromText(d.descriptionText);
  evidence.push(...eligibility.evidence);
  const extracted = extractRequirements(
    title,
    d.descriptionText,
    cleanText(d.company),
  );
  evidence.push(...extracted.evidence);
  const visible = {
    title,
    company: cleanText(d.company),
    descriptionText: d.descriptionText,
    applyUrl: d.applyUrl,
    locations,
    workMode,
    jobType,
    experience,
    salary: d.salary?.salary ?? null,
    visas: eligibility.visas,
    employment: eligibility.employment,
    postedAt: d.postedAt,
  };
  const published = {
    ...visible,
    requisitionKey: d.requisitionKey,
    department: d.department ? cleanText(d.department).slice(0, 250) : null,
    sourceUrl: d.sourceUrl,
    locationText: formatLocations(locations, d.rawLocation),
    usEligibility: us,
    visaSponsorship: eligibility.visaSponsorship,
    employmentExcluded: eligibility.employmentExcluded,
    evidence,
    requirements: extracted.requirements,
    requirementsVersion: REQUIREMENTS_EXTRACTOR_VERSION,
  };
  return NormalizedJobSchema.parse({
    ...published,
    id: postingId(d.source, d.tenant, d.sourceJobId),
    source: d.source,
    tenant: d.tenant.toLowerCase(),
    sourceJobId: d.sourceJobId,
    sourceUpdatedAt: d.sourceUpdatedAt,
    // Covers every field that reaches the catalog, so any correction republishes.
    contentHash: sha256(published),
  });
}
