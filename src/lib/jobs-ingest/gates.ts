import { SOURCE_IDS, type NormalizedJob } from "./contract";
import { isSafeHttpsUrl } from "./text";

/**
 * Local quality gates. A posting is published only when `status === 'accepted'`.
 * `rejected`: definitively unsuitable for the US catalog.
 * `quarantined`: might be fine but a required fact is missing/suspicious; never
 * published until a later fetch (or a reviewed rule change) clears it.
 */
export const REJECT_REASONS = [
  "missing_title",
  "missing_company",
  "missing_apply_url",
  "unsafe_apply_url",
  "description_too_short",
  "description_too_long",
  "not_us",
  "posting_too_old",
  "closed_at_source",
  "duplicate",
  "source_not_permitted",
] as const;
export const QUARANTINE_REASONS = [
  "us_eligibility_unknown",
  "posted_at_in_future",
  "not_seen_recently",
  "suspected_spam",
  "normalize_failed",
] as const;
export type GateReason =
  | (typeof REJECT_REASONS)[number]
  | (typeof QUARANTINE_REASONS)[number];
export type GateStatus = "accepted" | "rejected" | "quarantined";

export type GateConfig = {
  minDescriptionChars: number;
  maxDescriptionChars: number;
  /** Do not publish postings whose stated posting date is older than this. Unknown dates pass. */
  maxPostedAgeDays: number;
  /** A posting must have been present in a complete source snapshot this recently. */
  maxHoursSinceSeen: number;
  permittedSources: readonly string[];
};

export const DEFAULT_GATES: GateConfig = {
  minDescriptionChars: 300,
  maxDescriptionChars: 50_000,
  maxPostedAgeDays: 60,
  maxHoursSinceSeen: 36,
  permittedSources: SOURCE_IDS,
};

export type GateContext = {
  now: Date;
  open: boolean;
  lastSeenAt: string;
  duplicateOf: string | null;
};

const SPAM = [
  /\b(earn|make)\s+\$\s?\d[\d,]*\s*(\+\s*)?(per|a|\/)\s*(week|day)\b/i,
  /\bcommission[\s-]only\b/i,
  /\b(no experience needed|work from home and earn|unlimited earning potential)\b/i,
  /\b(pay|send)\s+(a\s+)?(fee|deposit)\s+(to|for)\s+(apply|training|equipment)\b/i,
  /\btelegram\b.*\b(interview|contact)\b/i,
];

export function evaluateGates(
  job: NormalizedJob,
  ctx: GateContext,
  cfg: GateConfig = DEFAULT_GATES,
) {
  const reasons: GateReason[] = [];
  if (!cfg.permittedSources.includes(job.source))
    reasons.push("source_not_permitted");
  if (!ctx.open || (job.sourceExpiresAt && Date.parse(job.sourceExpiresAt) <= ctx.now.getTime()))
    reasons.push("closed_at_source");
  if (ctx.duplicateOf) reasons.push("duplicate");
  if (!job.title.trim()) reasons.push("missing_title");
  if (!job.company.trim()) reasons.push("missing_company");
  if (!job.applyUrl.trim()) reasons.push("missing_apply_url");
  else if (!isSafeHttpsUrl(job.applyUrl) || !isSafeHttpsUrl(job.sourceUrl))
    reasons.push("unsafe_apply_url");
  const len = job.descriptionText.trim().length;
  if (len < cfg.minDescriptionChars) reasons.push("description_too_short");
  if (len > cfg.maxDescriptionChars) reasons.push("description_too_long");
  if (job.usEligibility === "not_us") reasons.push("not_us");
  if (job.usEligibility === "unknown") reasons.push("us_eligibility_unknown");
  if (job.postedAt) {
    const age = ctx.now.getTime() - Date.parse(job.postedAt);
    if (age > cfg.maxPostedAgeDays * 86_400_000)
      reasons.push("posting_too_old");
    if (age < -6 * 3_600_000) reasons.push("posted_at_in_future");
  }
  if (
    ctx.now.getTime() - Date.parse(ctx.lastSeenAt) >
    cfg.maxHoursSinceSeen * 3_600_000
  )
    reasons.push("not_seen_recently");
  if (SPAM.some((re) => re.test(`${job.title}\n${job.descriptionText}`)))
    reasons.push("suspected_spam");
  const status: GateStatus = reasons.some((r) =>
    (REJECT_REASONS as readonly string[]).includes(r),
  )
    ? "rejected"
    : reasons.length
      ? "quarantined"
      : "accepted";
  return { status, reasons };
}
