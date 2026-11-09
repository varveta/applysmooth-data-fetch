// Versioned publication contract: keep byte-identical in backend and collector.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CatalogRowSchema } from '@/lib/jobs-ingest/contract';
export const identityPart = z.string().min(1).max(120).regex(/^\S+$/);
const urlFormat = z.string().url();
// Zod's URL parser trims surrounding whitespace. Preserve supplied bytes so
// provider-specific identity checks can reject a changed application URL.
const rawUrl = z.string().refine((value) => urlFormat.safeParse(value).success, 'Invalid URL');
export const StatelessCatalogRowSchema = CatalogRowSchema.extend({
  source_url: rawUrl,
  apply_url: rawUrl,
  attribution_url: rawUrl,
  source_job_id: identityPart,
  observed_source_job_id: identityPart,
  duplicate_posting_ids: z.array(z.string().min(1).max(250)).max(10_000),
}).strict();

export const PUBLISH_FINGERPRINT_VERSION = 1;
export const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const MarkSeenItemSchema = z
  .object({
    id: z.string().regex(/^job_[a-f0-9]{32}$/),
    expected_publish_fingerprint: FingerprintSchema,
    observed_source_job_id: identityPart,
  })
  .strict();
export type MarkSeenItem = z.infer<typeof MarkSeenItemSchema>;

/** UTF-8 JSON, sorted object keys, ordered arrays; JSON normalizes negative zero. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype)
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  throw new Error('Unsupported fingerprint value');
}
export function publicationFingerprint(input: unknown): string {
  const parsed = StatelessCatalogRowSchema.parse(input);
  const { first_seen_at: ignored, ...row } = parsed;
  void ignored;
  const payload = {
    version: PUBLISH_FINGERPRINT_VERSION,
    ...row,
    source_expires_at: row.source_expires_at ?? null,
    duplicate_posting_ids: [...new Set(row.duplicate_posting_ids)].sort(),
  };
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}
