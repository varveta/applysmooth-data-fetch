import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { toCatalogRow } from "@/lib/jobs-ingest/catalog";
import { SOURCE_IDS, type CatalogRow, type NormalizedJob } from "@/lib/jobs-ingest/contract";
import { dedupe } from "@/lib/jobs-ingest/dedupe";
import { evaluateGates, type GateStatus } from "@/lib/jobs-ingest/gates";
import { sha256 } from "@/lib/jobs-ingest/text";
import { getJson, pool } from "./lib/http";
import { loadBoard, DISCOVERY_SOURCES } from "./lib/load-board";
import { assertRunnerContext, clientFromEnv, MAX_BATCH_BYTES, type RequestMetrics } from "./lib/collector-client";
import { CollectorError, errorLine, safeReason, type Stage } from "./lib/diagnostics";
import { boardIdentities, type BoardIdentity as CatalogIdentity } from "./lib/board-identities";

export const TargetSchema = z.object({
  source: z.enum(SOURCE_IDS),
  tenant: z.string().min(1).max(120).regex(/^[a-z0-9_-]+$/),
  company: z.string().min(1).max(250),
});
export type StatelessTarget = z.infer<typeof TargetSchema>;
// Canonical source identity stays immutable; verification follows the currently observed copy.
export type StatelessCatalogRow = CatalogRow & { observed_source_job_id: string };
type BoardIdentity = { run_id: string; source: StatelessTarget["source"]; tenant: string };
export type PublishBatch = BoardIdentity & { operation: "publish_batch"; batch_no: number; rows: CatalogRow[] };
const count = z.number().int().nonnegative().safe();
const PublishAck = z.object({
  accepted: count,
  results: z.array(z.object({ id: z.string(), outcome: z.enum(["inserted", "updated", "unchanged"]) })),
});
const CompleteAck = z.object({
  complete: z.literal(true), missing: count, withdrawn: count, marked_uncertain: count,
  guard: z.enum(["none", "zero_result", "large_drop", "partial_snapshot"]),
});

// Bound transaction work independently of the HTTP protocol ceiling. A single
// legitimate large row may exceed the target, but must still fit the hard limit.
export const MAX_PUBLISH_BATCH_ROWS = 25;
export const TARGET_PUBLISH_BATCH_BYTES = 250_000;

/** Include the complete envelope, batch number, JSON escaping and UTF-8 in both limits. */
export function splitBatches(identity: BoardIdentity, rows: CatalogRow[]): PublishBatch[] {
  const batches: PublishBatch[] = [];
  const make = (batch_no: number): PublishBatch => ({ operation: "publish_batch", ...identity, batch_no, rows: [] });
  let batch = make(0);
  let bytes = Buffer.byteLength(JSON.stringify(batch));
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (batch.rows.length && (batch.rows.length >= MAX_PUBLISH_BATCH_ROWS ||
        bytes + size + 1 > TARGET_PUBLISH_BATCH_BYTES)) {
      batches.push(batch);
      batch = make(batches.length);
      bytes = Buffer.byteLength(JSON.stringify(batch));
    }
    if (bytes + size + (batch.rows.length ? 1 : 0) > MAX_BATCH_BYTES)
      throw new CollectorError("Single catalog row exceeds batch byte limit");
    bytes += size + (batch.rows.length ? 1 : 0);
    batch.rows.push(row);
  }
  if (batch.rows.length) batches.push(batch);
  return batches;
}

function normalizeBoard(target: StatelessTarget, body: unknown) {
  const adapter = ADAPTERS[target.source];
  const listing = adapter.parseListing(body);
  // Greenhouse exposes a total. An explicitly partial envelope must never reconcile absence.
  if (target.source === "greenhouse" && body && typeof body === "object" && "meta" in body) {
    const meta = z.object({ total: count }).parse(body.meta);
    if (meta.total !== listing.length) throw new CollectorError("Incomplete board listing: total mismatch");
  }
  const jobs = new Map<string, NormalizedJob>();
  for (const raw of listing) {
    adapter.postingId(raw);
    const job = adapter.normalize(raw, target.tenant, target.company);
    const prior = jobs.get(job.id);
    if (prior && prior.contentHash !== job.contentHash)
      throw new CollectorError("Incomplete board listing: conflicting duplicate identity");
    jobs.set(job.id, job);
  }
  return jobs;
}

function prepareJobs(target: StatelessTarget, jobs: Map<string, NormalizedJob>, now: Date, anchors: Map<string, CatalogIdentity>) {
  const adapter = ADAPTERS[target.source];
  const seenAt = now.toISOString();
  const ordered = [...jobs.values()].sort((a, b) => a.id.localeCompare(b.id));
  const { canonicalOf, members } = dedupe(ordered.map((job) => ({
    ...job, firstSeenAt: anchors.get(job.id)?.first_seen_at ?? seenAt,
    published: anchors.has(job.id), usEligible: job.usEligibility === "us",
  })));
  // Historical ownership is authoritative. Today's dedupe only assigns new members;
  // it must never split an established identity or merge two established identities.
  type Group = { anchor?: CatalogIdentity; jobs: NormalizedJob[] };
  const established = new Map<string, Group>();
  for (const job of ordered) {
    const anchor = anchors.get(job.id);
    if (!anchor) continue;
    const group = established.get(anchor.id) ?? { anchor, jobs: [] };
    group.jobs.push(job);
    established.set(anchor.id, group);
  }
  const decisions = new Map<string, GateStatus>(ordered.map((job) => [job.id,
    evaluateGates(job, { now, open: true, lastSeenAt: seenAt, duplicateOf: null }).status,
  ]));
  const identity_resolution = { splits: 0, merges: 0, quarantined: 0 };
  const quarantinedPostingIds = new Set<string>();
  const quarantine = (job: NormalizedJob) => {
    if (decisions.get(job.id) !== "accepted") return;
    decisions.set(job.id, "quarantined");
    identity_resolution.quarantined++;
    quarantinedPostingIds.add(job.id);
  };
  const fresh: Group[] = [];
  for (const ids of members.values()) {
    const group = ids.map((id) => jobs.get(id)!);
    const owners = new Set(group.flatMap((job) => {
      const anchor = anchors.get(job.id);
      return anchor ? [anchor.id] : [];
    }));
    const newMembers = group.filter((job) => !anchors.has(job.id));
    if (owners.size > 1) {
      identity_resolution.merges++;
      // There is no evidence deciding which existing ID owns a new ambiguous member.
      newMembers.forEach(quarantine);
    } else if (owners.size === 1) {
      established.get(owners.values().next().value!)!.jobs.push(...newMembers);
    } else {
      fresh.push({ jobs: newMembers });
    }
  }

  const rows: StatelessCatalogRow[] = [];
  for (const group of [...established.values(), ...fresh]) {
    const anchor = group.anchor;
    if (anchor && new Set(group.jobs.map((job) => canonicalOf.get(job.id))).size > 1)
      identity_resolution.splits++;
    const eligible = group.jobs.filter((job) => decisions.get(job.id) === "accepted")
      .sort((a, b) => Number(anchors.has(b.id)) - Number(anchors.has(a.id)) || a.id.localeCompare(b.id));
    // Quality checks precede representative selection. An ineligible original must
    // not hide an eligible alias. Prefer known surviving aliases over fresh postings
    // so a new lower ID cannot select a different branch of a split identity.
    const job = eligible.find((candidate) => candidate.sourceJobId === anchor?.source_job_id) ?? eligible[0];
    if (!job) continue;
    const component = canonicalOf.get(job.id);
    const ownedDuplicates = group.jobs.filter((candidate) => canonicalOf.get(candidate.id) === component)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const candidate of eligible) {
      if (candidate.id === job.id) continue;
      if (canonicalOf.get(candidate.id) !== component) quarantine(candidate);
      else decisions.set(candidate.id, "rejected");
    }
    const row: StatelessCatalogRow = { ...toCatalogRow(job, {
      firstSeenAt: anchor?.first_seen_at ?? seenAt,
      duplicates: ownedDuplicates.filter((candidate) => candidate.id !== job.id),
      attribution: { ...adapter.attribution(target.tenant),
        ...(DISCOVERY_SOURCES.includes(target.source) ? { url: job.sourceUrl } : {}),
      },
    }), observed_source_job_id: job.sourceJobId };
    if (anchor) {
      row.id = anchor.id;
      row.source_job_id = anchor.source_job_id;
      // Keep known aliases, but never borrow another anchor's members or adopt a new
      // posting from an unselected split branch. That would poison future snapshots.
      row.duplicate_posting_ids = [...new Set([...anchor.duplicate_posting_ids, ...ownedDuplicates.map((candidate) => candidate.id)])]
        .filter((id) => id !== `${target.source}:${target.tenant}:${anchor.source_job_id}`).sort();
    }
    row.content_hash = sha256({ job: job.contentHash, locations: row.locations, dup: row.duplicate_posting_ids });
    rows.push(row);
  }
  const gates: Record<string, number> = {};
  for (const status of decisions.values()) gates[status] = (gates[status] ?? 0) + 1;
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { rows, fetched_count: jobs.size, gates, identity_resolution,
    quarantined_posting_ids: [...quarantinedPostingIds].sort(),
    quarantined_count: quarantinedPostingIds.size };
}

/** Offline preparation requires an explicit identity snapshot too; an empty snapshot means a new board. */
export function prepareBoard(target: StatelessTarget, body: unknown, now: Date, snapshot: unknown) {
  return prepareJobs(target, normalizeBoard(target, body), now, boardIdentities(snapshot, target.source, target.tenant));
}

export async function runStateless(options: {
  targets: StatelessTarget[];
  client: { call(body: unknown): Promise<unknown>; metrics: RequestMetrics };
  runId?: string;
  now?: Date;
  get?: typeof getJson;
  log?: (line: string) => void;
}) {
  const targets = z.array(TargetSchema).min(1).parse(options.targets);
  if (new Set(targets.map((t) => `${t.source}:${t.tenant}`)).size !== targets.length)
    throw new CollectorError("Duplicate configured board");
  const run_id = z.uuid().parse(options.runId ?? randomUUID());
  const now = options.now ?? new Date();
  const log = options.log ?? console.log;
  const started = Date.now();
  let fetchRequests = 0, fetchedBytes = 0;
  const failures = await pool(targets, (t) => new URL(ADAPTERS[t.source].listUrl(t.tenant)).host, 8, 4, async (target) => {
    const board = `${target.source}:${target.tenant}`;
    const identity = { run_id, source: target.source, tenant: target.tenant };
    let stage: Stage = "fetch";
    try {
      let jobs: Map<string, NormalizedJob>;
      try {
        const response = await loadBoard(target, options.get ?? getJson);
        fetchRequests += response.attempts;
        fetchedBytes += response.bytes;
        jobs = normalizeBoard(target, response.body);
        if ("discovery" in response) log(JSON.stringify({ stage: "fetch", board, run_id, discovery: response.discovery }));
      } catch (error) {
        log(errorLine("fetch", board, error));
        stage = "publish";
        const ack = await options.client.call({ operation: "board_fetch_failed", ...identity, reason: safeReason(error) });
        if (!z.object({ recorded: z.literal(true) }).safeParse(ack).success)
          throw new CollectorError("Invalid board_fetch_failed acknowledgment");
        stage = "fetch";
        throw new CollectorError("Board fetch failed; failure recorded");
      }
      stage = "publish";
      const snapshot = await options.client.call({ operation: "board_identities", ...identity,
        ...(DISCOVERY_SOURCES.includes(target.source) ? { posting_ids: [...jobs.keys()] } : {}),
      });
      const prepared = prepareJobs(target, jobs, now, boardIdentities(snapshot, target.source, target.tenant));
      log(JSON.stringify({ stage: "fetch", board, run_id, fetched_count: prepared.fetched_count, accepted_count: prepared.rows.length, gates: prepared.gates, identity_resolution: prepared.identity_resolution }));
      // Preflight every row before sending the first batch.
      const batches = splitBatches(identity, prepared.rows);
      const outcomes = { inserted: 0, updated: 0, unchanged: 0 };
      for (const batch of batches) {
        const ack = PublishAck.parse(await options.client.call(batch));
        const ids = new Set(batch.rows.map((row) => row.id));
        if (ack.accepted !== ids.size || ack.results.length !== ids.size ||
            new Set(ack.results.map((result) => result.id)).size !== ids.size ||
            ack.results.some((result) => !ids.has(result.id)))
          throw new CollectorError("Publish acknowledgment mismatch; board not completed");
        for (const result of ack.results) outcomes[result.outcome]++;
        log(JSON.stringify({ stage, board, run_id, batch_no: batch.batch_no, accepted: ack.accepted }));
      }
      stage = "complete";
      const complete = CompleteAck.parse(await options.client.call({
        operation: "complete_board", ...identity, batches_expected: batches.length,
        fetched_count: prepared.fetched_count, accepted_count: prepared.rows.length,
        quarantined_posting_ids: prepared.quarantined_posting_ids.slice(0, 500),
        quarantined_count: prepared.quarantined_count,
      }));
      log(JSON.stringify({ stage, board, run_id, fetched_count: prepared.fetched_count, accepted_count: prepared.rows.length, outcomes, ...complete }));
    } catch (error) {
      log(errorLine(stage, board, error));
      throw error;
    }
  });
  const summary = {
    run_id, boards: targets.length, failed: failures.length, duration_ms: Date.now() - started,
    fetch_requests: fetchRequests, fetched_bytes: fetchedBytes,
    collector_requests: options.client.metrics.requests, payload_bytes: options.client.metrics.payload_bytes,
    requests: fetchRequests + options.client.metrics.requests,
  };
  log(JSON.stringify({ stage: "complete", board: "run", ...summary }));
  if (failures.length) throw new CollectorError(`${failures.length} board(s) failed`);
  return summary;
}

async function main() {
  assertRunnerContext();
  const client = clientFromEnv();
  const config = JSON.parse(readFileSync("ingest/config/targets.json", "utf8"));
  await runStateless({ targets: config.targets, client });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(errorLine("complete", "run", error));
    process.exitCode = 1;
  });
}
