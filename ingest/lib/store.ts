import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NormalizedJobSchema } from "@/lib/jobs-ingest/contract";
import { normKey } from "@/lib/jobs-ingest/text";

export const PublicationIdentitySchema = NormalizedJobSchema.pick({
  source: true,
  tenant: true,
  requisitionKey: true,
  title: true,
});

/** Persist the identity evidence independently of mutable normalization results. */
export function publicationIdentityKey(value: unknown): string | null {
  const parsed = PublicationIdentitySchema.safeParse(value);
  return parsed.success
    ? JSON.stringify({ ...parsed.data, title: normKey(parsed.data.title) })
    : null;
}

/**
 * Local archive (SQLite file, gitignored). Keeps every posting ever seen, its
 * normalized record, compressed raw payload versions, gate decisions and run
 * logs. Readable from DuckDB too: `INSTALL sqlite; ATTACH 'ingest/data/jobs.sqlite' (TYPE sqlite);`.
 */
export const SCHEMA = `
create table if not exists targets (
  source text not null, tenant text not null, company text not null,
  enabled integer not null default 1,
  last_ok_at text, last_error text, consecutive_failures integer not null default 0,
  consecutive_not_found integer not null default 0,
  mass_close_pending integer not null default 0,
  mass_close_ids text not null default '[]',
  primary key (source, tenant)
);
create table if not exists postings (
  id text primary key,
  source text not null, tenant text not null, source_job_id text not null,
  first_seen_at text not null, last_seen_at text not null, last_changed_at text not null,
  status text not null check (status in ('open', 'closed')),
  closed_at text, reopen_count integer not null default 0,
  content_hash text, normalized_json text, normalize_error text,
  title text, company text, location_text text, us_eligibility text, posted_at text,
  canonical_id text, gate_status text, gate_reasons text, gated_at text
);
create index if not exists postings_target on postings (source, tenant, status);
create index if not exists postings_gate on postings (gate_status);
-- Publication state is per destination: a local rehearsal expiring must not affect TEST.
create table if not exists publish_targets (
  posting_id text not null, target text not null, catalog_id text not null,
  identity_key text,
  state text not null check (state in ('published', 'withdrawn', 'expired', 'deleted')),
  first_published_at text, expires_at text, last_published_hash text,
  last_publish_at text, last_outcome text,
  primary key (posting_id, target)
);
create index if not exists publish_targets_state on publish_targets (target, state);
create table if not exists raw_payloads (
  posting_id text not null, payload_hash text not null, fetched_at text not null,
  payload_gz blob not null,
  primary key (posting_id, payload_hash)
);
create table if not exists runs (
  id integer primary key autoincrement,
  kind text not null, started_at text not null, finished_at text,
  args text, summary text
);
create table if not exists run_targets (
  run_id integer not null, source text not null, tenant text not null,
  ok integer not null, complete integer not null, attempts integer not null,
  http_status integer, listed integer, new_jobs integer, changed integer,
  reopened integer, closed integer, normalize_failures integer,
  bytes integer, duration_ms integer, error text
);
create table if not exists gate_log (
  run_id integer not null, posting_id text not null, at text not null,
  status text not null, reasons text not null
);
create table if not exists publish_log (
  run_id integer not null, posting_id text not null, at text not null,
  action text not null, outcome text not null
);
`;

export type Store = DatabaseSync & { path: string };

export function openStore(path: string): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path) as Store;
  db.path = path;
  db.exec(
    "pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;",
  );
  db.exec(SCHEMA);
  // Columns added after the first pilot; `create table if not exists` does not add them.
  for (const [table, column, ddl] of [
    ["publish_targets", "identity_key", "text"],
    ["targets", "mass_close_pending", "integer not null default 0"],
    ["targets", "mass_close_ids", "text not null default '[]'"],
    ["targets", "consecutive_not_found", "integer not null default 0"],
  ]) {
    const cols = db.prepare(`pragma table_info(${table})`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === column))
      db.exec(`alter table ${table} add column ${column} ${ddl}`);
  }
  // Existing ledgers can be backfilled only while their original identity is known.
  const saveIdentity = db.prepare(
    "update publish_targets set identity_key = ? where posting_id = ? and target = ?",
  );
  for (const row of db
    .prepare(
      `select t.posting_id, t.target, p.normalized_json from publish_targets t
     join postings p on p.id = t.posting_id where t.identity_key is null and p.normalized_json is not null`,
    )
    .all() as {
    posting_id: string;
    target: string;
    normalized_json: string;
  }[]) {
    let identity: string | null = null;
    try {
      identity = publicationIdentityKey(JSON.parse(row.normalized_json));
    } catch {
      /* Keep unknown identities closed to handoff. */
    }
    if (identity) saveIdentity.run(identity, row.posting_id, row.target);
  }
  return db;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}

export function startRun(
  db: DatabaseSync,
  kind: string,
  args: unknown,
): number {
  const r = db
    .prepare("insert into runs (kind, started_at, args) values (?, ?, ?)")
    .run(kind, new Date().toISOString(), JSON.stringify(args));
  return Number(r.lastInsertRowid);
}

export function finishRun(db: DatabaseSync, id: number, summary: unknown) {
  db.prepare("update runs set finished_at = ?, summary = ? where id = ?").run(
    new Date().toISOString(),
    JSON.stringify(summary),
    id,
  );
}

export function fileSize(path: string): number {
  let total = 0;
  for (const p of [path, `${path}-wal`]) {
    try {
      total += statSync(p).size;
    } catch {
      /* absent */
    }
  }
  return total;
}
