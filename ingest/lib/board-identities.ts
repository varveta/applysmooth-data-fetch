import { z } from "zod";
import { publicJobId } from "@/lib/jobs-ingest/catalog";
import { postingId } from "@/lib/jobs-ingest/build";
import { SOURCE_IDS, type SourceId } from "@/lib/jobs-ingest/contract";
import { CollectorError } from "./diagnostics";

export const BoardIdentitySchema = z.object({
  id: z.string().min(1).max(250),
  source_job_id: z.string().min(1).max(120),
  first_seen_at: z.iso.datetime({ offset: true }),
  duplicate_posting_ids: z.array(z.string().min(1).max(250)),
});
export type BoardIdentity = z.infer<typeof BoardIdentitySchema>;

/** Server-owned identity history, including withdrawn/archived/tombstoned anchors. */
export function boardIdentities(body: unknown, source: SourceId, tenant: string) {
  const snapshot = z.object({
    source: z.enum(SOURCE_IDS), tenant: z.string(), complete: z.literal(true),
    identities: z.array(BoardIdentitySchema),
  }).parse(body);
  if (snapshot.source !== source || snapshot.tenant !== tenant)
    throw new CollectorError("Identity snapshot board mismatch");
  const byPosting = new Map<string, BoardIdentity>();
  const ids = new Set<string>();
  for (const anchor of snapshot.identities) {
    const original = postingId(source, tenant, anchor.source_job_id);
    if (anchor.id !== publicJobId(original) || ids.has(anchor.id))
      throw new CollectorError("Invalid or duplicate catalog identity in snapshot");
    ids.add(anchor.id);
    for (const key of new Set([original, ...anchor.duplicate_posting_ids])) {
      if (!key.startsWith(`${source}:${tenant}:`) || !key.slice(`${source}:${tenant}:`.length).trim())
        throw new CollectorError("Identity alias belongs to a different board");
      const prior = byPosting.get(key);
      if (prior && prior.id !== anchor.id)
        throw new CollectorError("Conflicting historical catalog identities");
      byPosting.set(key, anchor);
    }
  }
  return byPosting;
}
