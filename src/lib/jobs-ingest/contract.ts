import { z } from "zod";

/**
 * Collector-side contract for normalized job postings.
 *
 * Values use the exact option strings of the Match Engine filters
 * (`src/lib/match-engine/search.ts` FILTERS on feat/match-engine-draft2) so the
 * catalog → UI adapter is a rename, never a reinterpretation.
 *
 * Unknown is `null` (scalars) or `[]` (multi-value facets). A fact is only set
 * when the source states it; every non-structured value carries evidence.
 */

export const SOURCE_IDS = [
  "greenhouse", "lever", "ashby", "smartrecruiters", "workable", "personio",
  "recruitee", "jobicy", "himalayas", "weworkremotely", "remoteok", "remotive",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const WORK_MODES = ["Remote", "Hybrid", "On-site"] as const;
export const JOB_TYPES = [
  "Full-time",
  "Part-time",
  "Contract",
  "Internship",
] as const;
export const EXPERIENCE_LEVELS = [
  "Entry level",
  "Mid level",
  "Senior level",
  "Lead",
] as const;
export const VISA_OPTIONS = ["H1B", "OPT", "STEM OPT", "Other"] as const;
export const EMPLOYMENT_OPTIONS = ["W-2", "1099", "C2C", "Other"] as const;
export const SALARY_PERIODS = ["year", "month", "day", "hour"] as const;

export type WorkMode = (typeof WORK_MODES)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type VisaOption = (typeof VISA_OPTIONS)[number];
export type EmploymentOption = (typeof EMPLOYMENT_OPTIONS)[number];
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const EvidenceSchema = z.object({
  field: z.enum([
    "requirements",
    "usEligibility",
    "workMode",
    "jobType",
    "experience",
    "salary",
    "visas",
    "visaSponsorship",
    "employment",
    "employmentExcluded",
  ]),
  value: z.string().max(120),
  /** Verbatim source text (trimmed to 300 chars) or the structured field value. */
  quote: z.string().max(300),
  method: z.enum(["structured", "title", "text-pattern"]),
  /** Source field the quote came from, e.g. `categories.commitment`, `description`. */
  sourceField: z.string().max(120),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const LocationSchema = z.object({
  raw: z.string().max(250),
  city: z.string().max(120).nullable(),
  /** US state / region name as stated, or two-letter US state code expanded. */
  region: z.string().max(120).nullable(),
  /** ISO-3166 alpha-2 when stated explicitly; null when the source does not say. */
  country: z.string().length(2).nullable(),
  remote: z.boolean(),
});
export type JobLocation = z.infer<typeof LocationSchema>;

export const SalarySchema = z.object({
  min: z.number().positive().nullable(),
  max: z.number().positive().nullable(),
  /** ISO-4217, only when stated. `$` alone is not proof of USD. */
  currency: z.string().length(3).nullable(),
  period: z.enum(SALARY_PERIODS).nullable(),
  text: z.string().max(150),
});
export type Salary = z.infer<typeof SalarySchema>;

const skillTerms = z.array(z.string().min(1).max(120)).max(50);
/** Exactly the Match Engine `requirements` shape. null = nothing extractable (score hidden). */
export const RequirementsSchema = z.object({
  requiredSkills: skillTerms,
  preferredSkills: skillTerms,
  techStack: skillTerms,
  domainKeywords: skillTerms,
});

export const NormalizedJobSchema = z.object({
  /** Stable namespaced posting id: `<source>:<tenant>:<sourceJobId>`. */
  id: z.string().min(1).max(250),
  source: z.enum(SOURCE_IDS),
  tenant: z.string().min(1).max(120),
  sourceJobId: z.string().min(1).max(120),
  /** Employer requisition identifier shared by multiple posts of one job, when exposed. */
  requisitionKey: z.string().max(120).nullable(),
  title: z.string().max(250),
  company: z.string().max(250),
  department: z.string().max(250).nullable(),
  descriptionText: z.string(),
  applyUrl: z.string().max(2000),
  sourceUrl: z.string().max(2000),
  locations: z.array(LocationSchema).max(100),
  locationText: z.string().max(250),
  usEligibility: z.enum(["us", "not_us", "unknown"]),
  workMode: z.enum(WORK_MODES).nullable(),
  jobType: z.enum(JOB_TYPES).nullable(),
  experience: z.enum(EXPERIENCE_LEVELS).nullable(),
  salary: SalarySchema.nullable(),
  visas: z.array(z.enum(VISA_OPTIONS)),
  /** `not_offered` records explicit "cannot sponsor" language; it never maps to a filter value. */
  visaSponsorship: z.enum(["offered", "not_offered"]).nullable(),
  employment: z.array(z.enum(EMPLOYMENT_OPTIONS)),
  /** Arrangements the posting explicitly rules out ("No C2C"). */
  employmentExcluded: z.array(z.enum(EMPLOYMENT_OPTIONS)),
  evidence: z.array(EvidenceSchema),
  requirements: RequirementsSchema.nullable(),
  /** Extractor that produced `requirements`; part of the content hash so upgrades republish. */
  requirementsVersion: z.string(),
  /** Original posting time stated by the source. Never substituted with discovery time. */
  postedAt: z.string().datetime({ offset: true }).nullable(),
  sourceUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  /** Explicit source expiry; missing discovery items are never closure evidence. */
  sourceExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** sha256 over the user-visible normalized fields; drives change detection. */
  contentHash: z.string().length(64),
});
export type NormalizedJob = z.infer<typeof NormalizedJobSchema>;

/**
 * Columns app roles (anon/authenticated) may read — the column grant and the
 * `job_catalog_public` view in the migration. Everything else is internal provenance.
 */
export const PUBLIC_CATALOG_COLUMNS = [
  "id",
  "title",
  "company",
  "department",
  "description",
  "apply_url",
  "location_text",
  "locations",
  "work_mode",
  "job_type",
  "experience",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "salary_text",
  "visas",
  "visa_sponsorship",
  "employment",
  "employment_excluded",
  "requirements",
  "posted_at",
  "published_at",
  "expires_at",
  "content_updated_at",
] as const;

/**
 * One row of `public.job_catalog` as sent to `job_catalog_publish`.
 * snake_case mirrors the migration `20261021120000_job_catalog.sql`.
 */
export const CatalogRowSchema = z.object({
  id: z.string().min(1).max(250),
  source: z.enum(SOURCE_IDS),
  source_tenant: z.string(),
  source_job_id: z.string(),
  source_url: z.string().url(),
  apply_url: z.string().url(),
  attribution_name: z.string(),
  attribution_url: z.string().url(),
  title: z.string().min(1).max(250),
  company: z.string().min(1).max(250),
  department: z.string().nullable(),
  description: z.string().min(1).max(50000),
  location_text: z.string().max(250),
  locations: z.array(LocationSchema),
  work_mode: z.enum(WORK_MODES).nullable(),
  job_type: z.enum(JOB_TYPES).nullable(),
  experience: z.enum(EXPERIENCE_LEVELS).nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.enum(SALARY_PERIODS).nullable(),
  salary_text: z.string().nullable(),
  visas: z.array(z.enum(VISA_OPTIONS)),
  visa_sponsorship: z.enum(["offered", "not_offered"]).nullable(),
  employment: z.array(z.enum(EMPLOYMENT_OPTIONS)),
  employment_excluded: z.array(z.enum(EMPLOYMENT_OPTIONS)),
  eligibility_evidence: z.array(EvidenceSchema),
  requirements: RequirementsSchema.nullable(),
  posted_at: z.string().nullable(),
  first_seen_at: z.string(),
  source_updated_at: z.string().nullable(),
  source_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  content_hash: z.string().length(64),
  duplicate_posting_ids: z.array(z.string()),
});
export type CatalogRow = z.infer<typeof CatalogRowSchema>;
