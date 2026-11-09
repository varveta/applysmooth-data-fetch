import { z } from "zod";
import { publicationFingerprint, StatelessCatalogRowSchema, type MarkSeenItem } from "@/lib/jobs-collector/publication-contract";
import { CollectorError } from "./diagnostics";
import { MAX_BATCH_BYTES } from "./collector-client";
import type { BoardIdentity } from "./board-identities";
import type { PublishBatch } from "../stateless";

export function supportsDelta(snapshot: unknown): boolean {
  return z.object({ capabilities: z.object({ delta_publish_versions: z.array(z.number().int().positive()) }).optional() })
    .parse(snapshot).capabilities?.delta_publish_versions.includes(1) ?? false;
}
type CompactBatch = Omit<PublishBatch, "rows" | "operation"> & {
  operation: "mark_seen_batch"; fingerprint_version: 1; items: MarkSeenItem[];
};
export type PlannedBatch = { request: PublishBatch | CompactBatch; fallback: PublishBatch };

/** Preserve current transaction budgets, including safe full-row fallback size. */
export function planDeltaBatches(batches: PublishBatch[], anchors: Map<string, BoardIdentity>, enabled: boolean): PlannedBatch[] {
  const plans: PlannedBatch[] = [];
  const byId = new Map([...anchors.values()].map(anchor => [anchor.id, anchor]));
  for (const batch of batches) {
    const full: typeof batch.rows = [], seen: typeof batch.rows = [];
    for (const row of batch.rows) {
      const anchor = byId.get(row.id);
      (enabled && anchor?.mark_seen_eligible && anchor.publish_fingerprint_version === 1 &&
        anchor.publish_fingerprint === publicationFingerprint(row) ? seen : full).push(row);
    }
    for (const [rows, compact] of [[full, false], [seen, true]] as const) {
      if (!rows.length) continue;
      const fallback: PublishBatch = { ...batch, batch_no: plans.length, rows };
      const request: PlannedBatch["request"] = compact ? {
        operation: "mark_seen_batch", run_id: batch.run_id, source: batch.source, tenant: batch.tenant,
        batch_no: fallback.batch_no, fingerprint_version: 1,
        items: rows.map(row => ({ id: row.id, expected_publish_fingerprint: publicationFingerprint(row),
          observed_source_job_id: StatelessCatalogRowSchema.parse(row).observed_source_job_id })),
      } : fallback;
      for (const body of [request, fallback]) if (Buffer.byteLength(JSON.stringify(body)) > MAX_BATCH_BYTES)
        throw new CollectorError("Delta batch exceeds byte limit");
      plans.push({ request, fallback });
    }
  }
  return plans;
}
