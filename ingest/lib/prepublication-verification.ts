import type { NormalizedJob, SourceId } from "@/lib/jobs-ingest/contract";
import { evaluateGates } from "@/lib/jobs-ingest/gates";
import { verifier, type VerificationResult, type VerifyJob } from "../verify";
import { CollectorError } from "./diagnostics";
import { pool } from "./http";

export type PublicationChecker = Pick<ReturnType<typeof verifier>, "check" | "metrics">;
export type PublicationVerificationReport = {
  policy: "verified_getwork_candidates";
  candidate_count: number;
  checked_count: number;
  open_count: number;
  quarantined_count: number;
  all_candidates_verified: boolean;
  requests: number;
  outcomes: Record<string, number>;
  reason_counts: Record<string, number>;
};

/** One invocation owns this cache. Never persist evidence across runs or URLs. */
export function publicationChecker(checker: PublicationChecker = verifier({
  allowExperimental: true, concurrency: 3, perHost: 2,
})): PublicationChecker {
  const cache = new Map<string, Promise<VerificationResult>>();
  return {
    metrics: checker.metrics,
    async check(job: VerifyJob) {
      // Other sources retain their existing verification behavior.
      if (job.source !== "getwork") return checker.check(job);
      const key = JSON.stringify([job.source, job.tenant, job.source_job_id, job.apply_url]);
      let result = cache.get(key);
      if (!result) {
        result = Promise.resolve().then(() => checker.check(job)).then(value => {
          if (value.id !== job.id) throw new CollectorError("Invalid prepublication verification identity");
          return value;
        });
        cache.set(key, result);
      }
      // The same observed copy may represent a historical catalog anchor.
      return { ...await result, id: job.id };
    },
  };
}

/** Fetch/normalization evidence remains intact; only publication admission changes. */
export async function verifyPublicationCandidates(source: SourceId, jobs: readonly NormalizedJob[],
  now: Date, checker: PublicationChecker) {
  if (source !== "getwork") return undefined;
  if (jobs.length > 50) throw new CollectorError("Getwork verification candidate budget exceeded");
  const candidates = jobs.filter(job => evaluateGates(job, {
    now, open: true, lastSeenAt: now.toISOString(), duplicateOf: null,
  }).status === "accepted");
  const before = checker.metrics.requests;
  const results = new Map<string, VerificationResult>();
  const failures = await pool(candidates, job => new URL(job.applyUrl).hostname, 3, 2, async job => {
    const result = await checker.check({ id: job.id, source: job.source, tenant: job.tenant,
      source_job_id: job.sourceJobId, apply_url: job.applyUrl, reason: "prepublication" });
    if (result.id !== job.id || !["open", "closed", "link_broken", "uncertain"].includes(result.status) ||
        !["verify_source", "verify_link"].includes(result.stage) ||
        (result.status === "open" && result.stage !== "verify_link"))
      throw new CollectorError("Invalid prepublication verification result");
    results.set(job.id, result);
  });
  // A broken checker/budget is a board failure, not permission to publish partial work.
  if (failures.length || results.size !== candidates.length)
    throw new CollectorError("Prepublication verification did not complete");
  const summary: PublicationVerificationReport = { policy: "verified_getwork_candidates",
    candidate_count: candidates.length, checked_count: results.size, open_count: 0,
    quarantined_count: 0, all_candidates_verified: false, requests: checker.metrics.requests - before,
    outcomes: {}, reason_counts: {} };
  for (const result of results.values()) {
    summary.outcomes[result.status] = (summary.outcomes[result.status] ?? 0) + 1;
    if (result.status === "open") summary.open_count++;
    else {
      summary.quarantined_count++;
      const reason = `${result.stage}: ${result.status}: ${result.detail}`;
      summary.reason_counts[reason] = (summary.reason_counts[reason] ?? 0) + 1;
    }
  }
  summary.all_candidates_verified = candidates.length > 0 && summary.quarantined_count === 0;
  return { results, summary };
}
