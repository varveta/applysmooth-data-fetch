import { CollectorError } from "./diagnostics";
import { z } from "zod";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { publicJobId, toCatalogRow } from "@/lib/jobs-ingest/catalog";
import type { CatalogRow, NormalizedJob } from "@/lib/jobs-ingest/contract";
import { loadJob } from "./gate";
import {
  PublicationIdentitySchema,
  publicationIdentityKey,
  tx,
  type Store,
} from "./store";

const PublishOutcomeSchema = z
  .object({
    id: z.string().min(1),
    outcome: z.enum([
      "inserted",
      "updated",
      "reopened",
      "unchanged",
      "skipped_expired",
      "skipped_deleted",
    ]),
    published_at: z.string().datetime({ offset: true }).nullable(),
    expires_at: z.string().datetime({ offset: true }).nullable(),
  })
  .refine((result) => {
    if (result.outcome === "skipped_deleted") return true;
    if (!result.published_at || !result.expires_at) return false;
    const duration =
      Date.parse(result.expires_at) - Date.parse(result.published_at);
    return duration > 0 && duration <= 15 * 86_400_000;
  }, "Publish acknowledgment must contain a valid visibility window of at most 15 days");

export type PublishOutcome = z.infer<typeof PublishOutcomeSchema>;

const WithdrawOutcomeSchema = z.object({
  id: z.string().min(1),
  outcome: z.enum(["withdrawn", "missing", "not_published"]),
});

/** A missing/duplicate/unknown result is an ambiguous RPC failure, never local success. */
function acknowledgments<T extends { id: string }>(
  operation: string,
  received: unknown,
  expectedIds: string[],
  schema: z.ZodType<T>,
): T[] {
  const parsed = z.array(schema).safeParse(received);
  const expected = new Set(expectedIds);
  if (
    !parsed.success ||
    expected.size !== expectedIds.length ||
    parsed.data.length !== expected.size ||
    new Set(parsed.data.map((result) => result.id)).size !== expected.size ||
    parsed.data.some((result) => !expected.has(result.id))
  )
    throw new CollectorError(
      `${operation} acknowledgment mismatch; retry the same batch to reconcile target state`,
    );
  return parsed.data;
}
export interface CatalogWriter {
  label: string;
  publish(rows: CatalogRow[]): Promise<PublishOutcome[]>;
  withdraw(
    items: { id: string; reason: string }[],
  ): Promise<{ id: string; outcome: string }[]>;
  lifecycle(dryRun: boolean): Promise<Record<string, unknown>>;
  /** Service-role read of catalog state for specific IDs (batch verification). */
  readState(ids: string[]): Promise<CatalogState[]>;
  /** Rows exactly as app roles see them through `job_catalog_public` (service-role read). */
  readPublic(ids: string[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}
export type CatalogState = {
  id: string;
  status: string;
  published_at: string;
  expires_at: string;
  posted_at: string | null;
  content_hash: string;
  withdrawn_reason: string | null;
  archived_at: string | null;
};
type Candidate = {
  id: string;
  first_seen_at: string;
  normalized_json: string;
  status: string;
  gate_status: string | null;
  gate_reasons: string | null;
};
type TargetState = {
  posting_id: string;
  catalog_id: string;
  state: "published" | "withdrawn" | "expired" | "deleted";
  expires_at: string | null;
  last_published_hash: string | null;
};

export type PublishPlan = {
  publish: { postingId: string; row: CatalogRow }[];
  unchanged: number;
  withdraw: { postingId: string; id: string; reason: string }[];
  /** Postings whose window on this target has ended (or that the target already refused). */
  expiredLocally: string[];
  overBudget: number;
};

/**
 * A source posting can close while another copy of the same explicit requisition
 * remains open. Its accepted representative may change; its published identity
 * and visibility window must not. Retain ledger anchors even after expiry/deletion.
 */
export function createCatalogResolver(db: Store) {
  type Anchor = {
    postingKey: string;
    catalogId: string;
    firstSeenAt: string;
    sourceJobId: string;
  };
  const byPosting = new Map<string, Anchor>();
  const byRequisition = new Map<string, Map<string, Anchor>>();
  const resolvedPostings = new Map<string, string>();
  const unknownBoards = new Set<string>();
  const key = (job: NormalizedJob) =>
    job.requisitionKey ? publicationIdentityKey(job) : null;
  const rows = db
    .prepare(
      `select distinct p.id, p.first_seen_at, p.normalized_json, t.catalog_id, t.identity_key
     from publish_targets t join postings p on p.id = t.posting_id`,
    )
    .all() as {
    id: string;
    first_seen_at: string;
    normalized_json: string | null;
    catalog_id: string;
    identity_key: string | null;
  }[];
  for (const row of rows) {
    const job = loadJob(row.normalized_json);
    if (row.catalog_id !== publicJobId(row.id))
      throw new CollectorError(
        "Publication ledger contains an inconsistent catalog identity",
      );
    const anchor = {
      postingKey: row.id,
      catalogId: row.catalog_id,
      firstSeenAt: row.first_seen_at,
      sourceJobId: row.id.split(":").slice(2).join(":"),
    };
    byPosting.set(row.id, anchor);
    if (!row.identity_key) {
      unknownBoards.add(row.id.split(":").slice(0, 2).join(":"));
      continue;
    }
    const identity = PublicationIdentitySchema.parse(
      JSON.parse(row.identity_key),
    );
    // The immutable snapshot survives a later normalization failure. A correction
    // to the same known requisition may also supply its current compatible title.
    const reqs = new Set(
      identity.requisitionKey ? [publicationIdentityKey(identity)!] : [],
    );
    if (
      job &&
      job.source === identity.source &&
      job.tenant === identity.tenant &&
      job.requisitionKey === identity.requisitionKey
    ) {
      const current = key(job);
      if (current) reqs.add(current);
    }
    for (const req of reqs) {
      const group = byRequisition.get(req) ?? new Map<string, Anchor>();
      group.set(row.id, anchor);
      byRequisition.set(req, group);
    }
  }
  return (
    job: NormalizedJob,
    firstSeenAt: string,
    duplicates: NormalizedJob[] = [],
  ) => {
    const req = key(job);
    const group = req ? byRequisition.get(req) : undefined;
    if (group && group.size > 1)
      throw new CollectorError(
        "Multiple published identities exist for one requisition; reconcile them before publishing",
      );
    const anchor = byPosting.get(job.id) ?? group?.values().next().value;
    if (!anchor && unknownBoards.has(`${job.source}:${job.tenant}`))
      throw new CollectorError(
        "Original publication identity is unknown for this source board; reconcile its ledger before publishing new identities",
      );
    const row = toCatalogRow(job, {
      firstSeenAt: anchor?.firstSeenAt ?? firstSeenAt,
      duplicates,
      attribution: ADAPTERS[job.source].attribution(job.tenant),
    });
    if (anchor) {
      row.id = anchor.catalogId;
      // Keep the original identity; source/apply URLs and display facts follow the open copy.
      row.source_job_id = anchor.sourceJobId;
    }
    const prior = resolvedPostings.get(row.id);
    if (prior && prior !== job.id)
      throw new CollectorError(
        "Multiple current postings resolve to one catalog identity; reconcile the conflicting requisition before publishing",
      );
    resolvedPostings.set(row.id, job.id);
    return { postingKey: anchor?.postingKey ?? job.id, row };
  };
}

/**
 * Decide what to send to one target. Pure read of the local store; no network.
 * - Only canonical, open postings whose CURRENT content passed the gates are eligible.
 * - State is per target: a window that ended on the local rehearsal never blocks TEST.
 * - Capacity counts rows still live on the target after expiry and planned withdrawals.
 * - Unchanged = this target last accepted this exact hash; `resync` re-sends anyway.
 */
export function buildPlan(
  db: Store,
  now: Date,
  maxLiveRows: number,
  target: string,
  resync = false,
  /** Restrict publishing and withdrawals to these posting keys (batch mode). */
  only?: Set<string>,
): PublishPlan {
  if (!Number.isSafeInteger(maxLiveRows) || maxLiveRows < 0)
    throw new CollectorError("maxLiveRows must be a non-negative safe integer");
  const nowMs = now.getTime();
  const ended = (t: TargetState | undefined) =>
    !!t &&
    (t.state === "expired" ||
      t.state === "deleted" ||
      (!!t.expires_at && Date.parse(t.expires_at) <= nowMs));
  const states = new Map(
    (
      db
        .prepare(
          `select posting_id, catalog_id, state, expires_at, last_published_hash from publish_targets where target = ?`,
        )
        .all(target) as TargetState[]
    ).map((t) => [t.posting_id, t]),
  );
  const rawCandidates = db
    .prepare(
      `select id, first_seen_at, normalized_json, status, gate_status, gate_reasons
       from postings
       where status = 'open' and gate_status = 'accepted' and canonical_id = id
         and normalized_json is not null and gated_at >= last_changed_at
       order by coalesce(posted_at, first_seen_at) desc, id`,
    )
    .all() as Candidate[];
  const dupRows = db
    .prepare(
      `select canonical_id, normalized_json from postings where status = 'open' and canonical_id is not null and canonical_id <> id`,
    )
    .all() as { canonical_id: string; normalized_json: string | null }[];
  const dups = new Map<string, NormalizedJob[]>();
  for (const d of dupRows) {
    const j = loadJob(d.normalized_json);
    if (j) dups.set(d.canonical_id, [...(dups.get(d.canonical_id) ?? []), j]);
  }
  const resolve = createCatalogResolver(db);
  const candidates = rawCandidates.flatMap((candidate) => {
    const job = loadJob(candidate.normalized_json);
    return job
      ? [resolve(job, candidate.first_seen_at, dups.get(candidate.id) ?? [])]
      : [];
  });
  const eligible = new Set(candidates.map((candidate) => candidate.postingKey));
  const plan: PublishPlan = {
    publish: [],
    unchanged: 0,
    withdraw: [],
    expiredLocally: [],
    overBudget: 0,
  };

  // 1. Rows live on this target: expired → mark, no longer eligible → withdraw, else count as live.
  let live = 0;
  const why = db.prepare(
    `select status, gate_status, gate_reasons from postings where id = ?`,
  );
  for (const t of states.values()) {
    if (t.state !== "published") continue;
    // A batch may not mutate out-of-scope jobs, but they still occupy target capacity.
    if (only && !only.has(t.posting_id)) {
      if (!ended(t)) live++;
      continue;
    }
    if (ended(t)) {
      plan.expiredLocally.push(t.posting_id);
      continue;
    }
    if (eligible.has(t.posting_id)) {
      live++;
      continue;
    }
    const p = why.get(t.posting_id) as
      | {
          status: string;
          gate_status: string | null;
          gate_reasons: string | null;
        }
      | undefined;
    const reasons = JSON.parse(p?.gate_reasons ?? "[]") as string[];
    plan.withdraw.push({
      postingId: t.posting_id,
      id: t.catalog_id,
      reason:
        p?.status === "closed"
          ? "closed_at_source"
          : p?.gate_status
            ? (reasons[0] ?? p.gate_status)
            : "pending_revalidation",
    });
  }

  // 2. Eligible postings: update live rows, then fill remaining capacity with new/reopened ones.
  for (const c of candidates) {
    if (only && !only.has(c.postingKey)) continue;
    const t = states.get(c.postingKey);
    if (ended(t)) {
      if (t!.state === "published" || t!.state === "withdrawn")
        plan.expiredLocally.push(c.postingKey);
      continue;
    }
    const row = c.row;
    const isLive = t?.state === "published";
    if (!resync && isLive && t.last_published_hash === row.content_hash) {
      plan.unchanged++;
      continue;
    }
    if (!isLive) {
      if (live >= maxLiveRows) {
        plan.overBudget++;
        continue;
      }
      live++;
    }
    plan.publish.push({ postingId: c.postingKey, row });
  }
  plan.expiredLocally = [...new Set(plan.expiredLocally)];
  return plan;
}

export async function applyPlan(
  db: Store,
  runId: number,
  plan: PublishPlan,
  writer: CatalogWriter,
  batchSize = 100,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new CollectorError("batchSize must be an integer between 1 and 500");
  const publishIds = plan.publish.map((item) => item.row.id);
  const withdrawIds = plan.withdraw.map((item) => item.id);
  if (
    new Set(publishIds).size !== publishIds.length ||
    new Set(withdrawIds).size !== withdrawIds.length ||
    withdrawIds.some((id) => publishIds.includes(id))
  )
    throw new CollectorError(
      "Publish plan contains conflicting catalog identities; nothing sent",
    );
  const tally: Record<string, number> = {};
  const now = () => new Date().toISOString();
  const target = writer.label;
  const upsert = db.prepare(
    `insert into publish_targets (posting_id, target, catalog_id, identity_key, state, first_published_at, expires_at,
       last_published_hash, last_publish_at, last_outcome)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (posting_id, target) do update set
       catalog_id = excluded.catalog_id,
       identity_key = coalesce(publish_targets.identity_key, excluded.identity_key),
       state = excluded.state,
       first_published_at = coalesce(publish_targets.first_published_at, excluded.first_published_at),
       expires_at = coalesce(excluded.expires_at, publish_targets.expires_at),
       last_published_hash = coalesce(excluded.last_published_hash, publish_targets.last_published_hash),
       last_publish_at = excluded.last_publish_at,
       last_outcome = excluded.last_outcome`,
  );
  const setState = db.prepare(
    `update publish_targets set state = ?, last_publish_at = ?, last_outcome = ? where posting_id = ? and target = ?`,
  );
  const logIt = db.prepare(
    `insert into publish_log (run_id, posting_id, at, action, outcome) values (?, ?, ?, ?, ?)`,
  );
  const identityFor = db.prepare(
    `select p.normalized_json, t.identity_key from postings p
     left join publish_targets t on t.posting_id = p.id and t.target = ? where p.id = ?`,
  );
  for (let i = 0; i < plan.withdraw.length; i += 500) {
    const batch = plan.withdraw.slice(i, i + 500);
    const results = acknowledgments(
      "withdraw",
      await writer.withdraw(batch.map(({ id, reason }) => ({ id, reason }))),
      batch.map((b) => b.id),
      WithdrawOutcomeSchema,
    );
    const byCatalogId = new Map(batch.map((b) => [b.id, b.postingId]));
    tx(db, () => {
      for (const r of results) {
        const postingId = byCatalogId.get(r.id)!;
        tally[`withdraw_${r.outcome}`] =
          (tally[`withdraw_${r.outcome}`] ?? 0) + 1;
        // Preserve identity/window evidence even if the target row has disappeared.
        setState.run(
          r.outcome === "missing" ? "deleted" : "withdrawn",
          now(),
          `withdraw_${r.outcome}`,
          postingId,
          target,
        );
        logIt.run(runId, postingId, now(), "withdraw", r.outcome);
      }
    });
  }
  for (let i = 0; i < plan.publish.length; i += batchSize) {
    const batch = plan.publish.slice(i, i + batchSize);
    const identities = new Map(
      batch.map(({ postingId }) => {
        const original = identityFor.get(target, postingId) as
          | { normalized_json: string | null; identity_key: string | null }
          | undefined;
        const identity =
          original?.identity_key ??
          (original?.normalized_json
            ? publicationIdentityKey(JSON.parse(original.normalized_json))
            : null);
        if (!identity)
          throw new CollectorError(
            "Cannot publish without original publication identity evidence",
          );
        return [postingId, identity];
      }),
    );
    const results = acknowledgments(
      "publish",
      await writer.publish(batch.map((b) => b.row)),
      batch.map((b) => b.row.id),
      PublishOutcomeSchema,
    );
    const byCatalogId = new Map(batch.map((b) => [b.row.id, b]));
    tx(db, () => {
      for (const r of results) {
        const sent = byCatalogId.get(r.id);
        if (!sent) throw new CollectorError("Publish returned an unknown catalog identity");
        tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
        const state =
          r.outcome === "skipped_expired"
            ? "expired"
            : r.outcome === "skipped_deleted"
              ? "deleted"
              : "published";
        upsert.run(
          sent.postingId,
          target,
          r.id,
          identities.get(sent.postingId)!,
          state,
          r.published_at,
          r.expires_at,
          state === "published" ? sent.row.content_hash : null,
          now(),
          r.outcome,
        );
        logIt.run(runId, sent.postingId, now(), "publish", r.outcome);
      }
    });
  }
  if (plan.expiredLocally.length)
    tx(db, () =>
      plan.expiredLocally.forEach((id) =>
        setState.run("expired", now(), "expired_locally", id, target),
      ),
    );
  return tally;
}
