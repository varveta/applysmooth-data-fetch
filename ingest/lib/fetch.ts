import { gzipSync } from "node:zlib";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { postingId } from "@/lib/jobs-ingest/build";
import type { SourceId } from "@/lib/jobs-ingest/contract";
import { sha256 } from "@/lib/jobs-ingest/text";
import { getJson, pool } from "./http";
import { tx, type Store } from "./store";

export type Target = { source: SourceId; tenant: string; company: string };
export const DISABLE_AFTER_FAILURES = 3;
const KEEP_PAYLOAD_VERSIONS = 5;
const MASS_CLOSE_MIN = 20;
const MASS_CLOSE_SHARE = 0.5;

export function syncTargets(db: Store, targets: Target[]) {
  const up = db.prepare(
    `insert into targets (source, tenant, company) values (?, ?, ?)
     on conflict (source, tenant) do update set company = excluded.company`,
  );
  tx(db, () =>
    targets.forEach((t) => up.run(t.source, t.tenant.toLowerCase(), t.company)),
  );
}

type TargetRow = { source: SourceId; tenant: string; company: string };

/**
 * Fetch every enabled target. Per target, one complete snapshot:
 * new → insert; changed content → update + keep payload version; seen → bump
 * last_seen_at; closed→seen → reopen. Missing postings are closed ONLY when the
 * listing request succeeded and parsed as a complete list.
 */
export async function fetchAll(
  db: Store,
  runId: number,
  filter: {
    source?: string;
    tenant?: string;
    limit?: number;
    includeDisabled?: boolean;
    /** Only these boards (e.g. the tenants of a batch manifest). */
    only?: { source: string; tenant: string }[];
  },
  log: (line: string) => void,
) {
  const rows = db
    .prepare(
      `select source, tenant, company from targets
       where (? = 1 or enabled = 1) and (? is null or source = ?) and (? is null or tenant = ?)
       order by source, tenant`,
    )
    .all(
      filter.includeDisabled ? 1 : 0,
      filter.source ?? null,
      filter.source ?? null,
      filter.tenant ?? null,
      filter.tenant ?? null,
    ) as TargetRow[];
  const only =
    filter.only && new Set(filter.only.map((t) => `${t.source}:${t.tenant}`));
  const scoped = only
    ? rows.filter((t) => only.has(`${t.source}:${t.tenant}`))
    : rows;
  const targets = filter.limit ? scoped.slice(0, filter.limit) : scoped;
  const totals = {
    targets: targets.length,
    ok: 0,
    failed: 0,
    listed: 0,
    new: 0,
    changed: 0,
    reopened: 0,
    closed: 0,
    closeHeld: 0,
    normalizeFailures: 0,
    errors: 0,
  };
  const crashes = await pool(
    targets,
    (t) => t.source,
    8,
    4,
    async (t) => {
      const started = Date.now();
      const adapter = ADAPTERS[t.source];
      const res = await getJson(adapter.listUrl(t.tenant));
      let listing: unknown[] | null = null;
      let error = res.ok ? null : res.error;
      if (res.ok) {
        try {
          const parsed = adapter.parseListing(res.body);
          // If even one identity is unreadable, absence cannot prove a closure.
          // Validate the complete identity set before changing local posting state.
          for (const raw of parsed) adapter.postingId(raw);
          listing = parsed;
        } catch (e) {
          error = `unexpected listing shape: ${e instanceof Error ? e.message.slice(0, 200) : e}`;
        }
      }
      const now = new Date().toISOString();
      const stat = {
        listed: 0,
        new: 0,
        changed: 0,
        reopened: 0,
        closed: 0,
        closeHeld: 0,
        normalizeFailures: 0,
      };
      const recordTarget = () => {
        db.prepare(
          `insert into run_targets (run_id, source, tenant, ok, complete, attempts, http_status, listed, new_jobs, changed,
           reopened, closed, normalize_failures, bytes, duration_ms, error) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          runId,
          t.source,
          t.tenant,
          listing ? 1 : 0,
          listing ? 1 : 0,
          res.attempts,
          res.status ?? null,
          stat.listed,
          stat.new,
          stat.changed,
          stat.reopened,
          stat.closed,
          stat.normalizeFailures,
          res.ok ? res.bytes : 0,
          Date.now() - started,
          error,
        );
      };
      if (!listing) {
        tx(db, () => {
          db.prepare(
            `update targets set last_error = ?, consecutive_failures = consecutive_failures + 1,
             consecutive_not_found = case when ? in (404, 410) then consecutive_not_found + 1 else 0 end,
             enabled = case when consecutive_not_found + 1 >= ? and ? in (404, 410) then 0 else enabled end
           where source = ? and tenant = ?`,
          ).run(
            error,
            res.status ?? 0,
            DISABLE_AFTER_FAILURES,
            res.status ?? 0,
            t.source,
            t.tenant,
          );
          recordTarget();
        });
        totals.failed++;
      } else {
        tx(db, () => {
          const seen = new Set<string>();
          const get = db.prepare(
            "select status, content_hash from postings where id = ?",
          );
          const insert = db.prepare(
            `insert into postings (id, source, tenant, source_job_id, first_seen_at, last_seen_at, last_changed_at, status,
             content_hash, normalized_json, normalize_error, title, company, location_text, us_eligibility, posted_at)
           values (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const update = db.prepare(
            `update postings set last_seen_at = ?, status = 'open', closed_at = null,
             reopen_count = reopen_count + ?,
             last_changed_at = case when content_hash is ? then last_changed_at else ? end,
             -- Changed content must pass the gates again before it can be published.
             gate_status = case when content_hash is ? then gate_status else null end,
             content_hash = ?, normalized_json = ?, normalize_error = ?, title = ?, company = ?,
             location_text = ?, us_eligibility = ?, posted_at = ?
           where id = ?`,
          );
          const payload = db.prepare(
            `insert into raw_payloads (posting_id, payload_hash, fetched_at, payload_gz) values (?, ?, ?, ?)
             on conflict (posting_id, payload_hash) do update set fetched_at = excluded.fetched_at`,
          );
          const prune = db.prepare(
            `delete from raw_payloads where posting_id = ? and payload_hash not in
             (select payload_hash from raw_payloads where posting_id = ? order by fetched_at desc limit ?)`,
          );
          for (const raw of listing!) {
            const sourceJobId = adapter.postingId(raw);
            const id = postingId(t.source, t.tenant, sourceJobId);
            if (seen.has(id)) continue;
            seen.add(id);
            stat.listed++;
            let job = null;
            let normError: string | null = null;
            try {
              job = adapter.normalize(raw, t.tenant, t.company);
            } catch (e) {
              normError =
                e instanceof Error ? e.message.slice(0, 500) : String(e);
              stat.normalizeFailures++;
            }
            const hash = job?.contentHash ?? null;
            const fields = [
              hash,
              job ? JSON.stringify(job) : null,
              normError,
              job?.title ?? null,
              job?.company ?? t.company,
              job?.locationText ?? null,
              job?.usEligibility ?? null,
              job?.postedAt ?? null,
            ];
            const prior = get.get(id) as
              | { status: string; content_hash: string | null }
              | undefined;
            if (!prior) {
              insert.run(
                id,
                t.source,
                t.tenant,
                sourceJobId,
                now,
                now,
                now,
                ...fields,
              );
              stat.new++;
            } else {
              const reopened = prior.status === "closed" ? 1 : 0;
              if (prior.content_hash !== hash) stat.changed++;
              stat.reopened += reopened;
              update.run(now, reopened, hash, now, hash, ...fields, id);
            }
            const rawText = JSON.stringify(raw);
            if (
              payload.run(id, sha256(rawText), now, gzipSync(rawText)).changes
            )
              prune.run(id, id, KEEP_PAYLOAD_VERSIONS);
          }
          // Complete snapshot → anything open for this tenant that was not listed has closed.
          const open = db
            .prepare(
              `select id from postings where source = ? and tenant = ? and status = 'open'`,
            )
            .all(t.source, t.tenant) as { id: string }[];
          const missing = open.filter(({ id }) => !seen.has(id));
          // A board that suddenly drops most of its jobs (API glitch, empty response, ATS migration)
          // only closes them when the next complete snapshot agrees.
          const mass =
            missing.length >= MASS_CLOSE_MIN &&
            missing.length > open.length * MASS_CLOSE_SHARE;
          const pending = (
            db
              .prepare(
                "select mass_close_ids ids from targets where source = ? and tenant = ?",
              )
              .get(t.source, t.tenant) as { ids: string }
          ).ids;
          const priorMissing = new Set<string>(JSON.parse(pending));
          const held: string[] = [];
          const close = db.prepare(
            `update postings set status = 'closed', closed_at = ? where id = ?`,
          );
          for (const { id } of missing) {
            // Different partial snapshots can omit different jobs. Only a repeated
            // absence confirms a member of a suspiciously large drop.
            if (mass && !priorMissing.has(id)) held.push(id);
            else {
              close.run(now, id);
              stat.closed++;
            }
          }
          stat.closeHeld = held.length;
          db.prepare(
            `update targets set last_ok_at = ?, last_error = ?, consecutive_failures = 0,
             consecutive_not_found = 0, mass_close_pending = ?, mass_close_ids = ? where source = ? and tenant = ?`,
          ).run(
            now,
            stat.closeHeld
              ? `held ${stat.closeHeld} closures pending confirmation`
              : null,
            stat.closeHeld ? 1 : 0,
            JSON.stringify(held),
            t.source,
            t.tenant,
          );
          // Commit the complete-snapshot audit together with every state change.
          // An audit failure must not leave closures or partial refreshes behind.
          recordTarget();
        });
        totals.ok++;
        for (const k of Object.keys(stat) as (keyof typeof stat)[])
          totals[k] += stat[k];
      }
      log(
        listing
          ? `ok   ${t.source}:${t.tenant} listed=${stat.listed} new=${stat.new} changed=${stat.changed} closed=${stat.closed}${stat.closeHeld ? ` HELD=${stat.closeHeld}` : ""} reopened=${stat.reopened} normFail=${stat.normalizeFailures} (${res.attempts} attempt${res.attempts > 1 ? "s" : ""})`
          : `FAIL ${t.source}:${t.tenant} ${error} (${res.attempts} attempts) — nothing closed`,
      );
    },
  );
  // DB/processing errors roll back their target transaction; report every target error.
  for (const { item: t, error } of crashes) {
    const message =
      `internal error: ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        500,
      );
    totals.errors++;
    db.prepare(
      `insert into run_targets (run_id, source, tenant, ok, complete, attempts, error) values (?, ?, ?, 0, 0, 0, ?)`,
    ).run(runId, t.source, t.tenant, message);
    log(`ERROR ${t.source}:${t.tenant} ${message}`);
  }
  return totals;
}
