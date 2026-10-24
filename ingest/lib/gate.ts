import {
  NormalizedJobSchema,
  type NormalizedJob,
} from "@/lib/jobs-ingest/contract";
import { dedupe } from "@/lib/jobs-ingest/dedupe";
import {
  DEFAULT_GATES,
  evaluateGates,
  type GateConfig,
} from "@/lib/jobs-ingest/gates";
import { tx, type Store } from "./store";

type Row = {
  id: string;
  status: "open" | "closed";
  normalized_json: string | null;
  normalize_error: string | null;
  first_seen_at: string;
  last_seen_at: string;
  published: number;
  gate_status: string | null;
  gate_reasons: string | null;
  canonical_id: string | null;
};

export function loadJob(json: string | null): NormalizedJob | null {
  if (!json) return null;
  const parsed = NormalizedJobSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

/**
 * Re-evaluate dedupe + quality gates for every posting that is open or still
 * live in the catalog. Deterministic and idempotent; decisions that changed are
 * appended to gate_log.
 */
export function gateAll(
  db: Store,
  runId: number,
  cfg: GateConfig = DEFAULT_GATES,
  now = new Date(),
) {
  const rows = db
    .prepare(
      `select id, status, normalized_json, normalize_error, first_seen_at, last_seen_at,
              exists (select 1 from publish_targets t where t.posting_id = p0.id and t.state = 'published') as published,
              gate_status, gate_reasons, canonical_id
       from postings p0
       where status = 'open' or gate_status is null or gate_status = 'accepted'
          or exists (select 1 from publish_targets t where t.posting_id = p0.id and t.state = 'published')`,
    )
    .all() as Row[];
  const jobs = new Map<string, NormalizedJob>();
  for (const r of rows) {
    const job = loadJob(r.normalized_json);
    if (job) jobs.set(r.id, job);
  }
  const openRows = rows.filter((r) => r.status === "open" && jobs.has(r.id));
  const { canonicalOf, possibleDuplicates } = dedupe(
    openRows.map((r) => {
      const j = jobs.get(r.id)!;
      return {
        id: r.id,
        source: j.source,
        tenant: j.tenant,
        requisitionKey: j.requisitionKey,
        title: j.title,
        company: j.company,
        locations: j.locations,
        descriptionText: j.descriptionText,
        firstSeenAt: r.first_seen_at,
        published: r.published === 1,
        usEligible: j.usEligibility === "us",
      };
    }),
  );
  const counts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  const set = db.prepare(
    `update postings set gate_status = ?, gate_reasons = ?, canonical_id = ?, gated_at = ? where id = ?`,
  );
  const logIt = db.prepare(
    `insert into gate_log (run_id, posting_id, at, status, reasons) values (?, ?, ?, ?, ?)`,
  );
  tx(db, () => {
    for (const r of rows) {
      const job = jobs.get(r.id);
      const canonical = canonicalOf.get(r.id) ?? r.id;
      const result = job
        ? evaluateGates(
            job,
            {
              now,
              open: r.status === "open",
              lastSeenAt: r.last_seen_at,
              duplicateOf: canonical !== r.id ? canonical : null,
            },
            cfg,
          )
        : {
            status: "quarantined" as const,
            reasons: ["normalize_failed" as const],
          };
      const reasons = JSON.stringify(result.reasons);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      for (const reason of result.reasons)
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      // gated_at always advances: publishing requires gated_at >= last_changed_at.
      set.run(result.status, reasons, canonical, now.toISOString(), r.id);
      if (
        result.status !== r.gate_status ||
        reasons !== r.gate_reasons ||
        canonical !== r.canonical_id
      )
        logIt.run(runId, r.id, now.toISOString(), result.status, reasons);
    }
  });
  return {
    evaluated: rows.length,
    counts,
    reasonCounts,
    possibleDuplicateGroups: possibleDuplicates.length,
    possibleDuplicates,
  };
}
