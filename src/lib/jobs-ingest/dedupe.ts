import type { JobLocation } from "./contract";
import { normKey, sha256 } from "./text";

export type DedupeItem = {
  id: string;
  source: string;
  tenant: string;
  requisitionKey: string | null;
  title: string;
  company: string;
  locations: JobLocation[];
  descriptionText: string;
  firstSeenAt: string;
  /** Already live in the catalog: keeps its public ID when a group forms later. */
  published: boolean;
  /** Prefer a US-eligible copy so a multi-country requisition is not represented by its non-US post. */
  usEligible: boolean;
};

export type DedupeResult = {
  /** posting id → canonical posting id (itself when canonical). */
  canonicalOf: Map<string, string>;
  /** canonical id → all member ids (including itself) */
  members: Map<string, string[]>;
  /** Same company/title/location but different text or requisition: kept separate, listed for review. */
  possibleDuplicates: string[][];
};

const locKey = (locations: JobLocation[]) =>
  locations
    .map(
      (l) =>
        `${normKey(l.city ?? "")}/${normKey(l.region ?? "")}/${l.country ?? ""}/${l.remote ? "r" : ""}`,
    )
    .sort()
    .join(";");

/**
 * Identity rules (strongest first). Title/location similarity alone never merges:
 * 1. Same source posting → same row (handled by the store's primary key).
 * 2. Same employer requisition (`requisitionKey`, e.g. Greenhouse internal_job_id)
 *    and same title within one tenant → one job posted in several locations.
 * 3. Same company + title + location set + identical description text → repost
 *    (also catches the same job on two ATS boards).
 * 4. Different known requisition IDs are never merged, even with identical text.
 * Distinct requisitions that share title/city stay separate.
 */
export function dedupe(items: DedupeItem[]): DedupeResult {
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const byKey = new Map<string, string>();
  const link = (key: string, id: string) => {
    const prior = byKey.get(key);
    if (prior) union(id, prior);
    else byKey.set(key, id);
  };
  const looseGroups = new Map<string, string[]>();
  const textBuckets = new Map<string, DedupeItem[]>();
  for (const i of items) {
    const title = normKey(i.title);
    const company = normKey(i.company);
    if (i.requisitionKey)
      link(`req|${i.source}|${i.tenant}|${i.requisitionKey}|${title}`, i.id);
    const text = `${company}|${title}|${locKey(i.locations)}|${sha256(normKey(i.descriptionText))}`;
    textBuckets.set(text, [...(textBuckets.get(text) ?? []), i]);
    const loose = `${company}|${title}|${locKey(i.locations)}`;
    looseGroups.set(loose, [...(looseGroups.get(loose) ?? []), i.id]);
  }
  // Identical text is only a repost when it cannot be two known openings: a bucket
  // holding more than one distinct requisition stays separate (rule 4).
  for (const bucket of textBuckets.values()) {
    const reqs = new Set(
      bucket
        .filter((i) => i.requisitionKey)
        .map((i) => `${i.source}|${i.tenant}|${i.requisitionKey}`),
    );
    if (reqs.size <= 1)
      for (const i of bucket.slice(1)) union(i.id, bucket[0].id);
  }
  const groups = new Map<string, DedupeItem[]>();
  for (const i of items)
    groups.set(find(i.id), [...(groups.get(find(i.id)) ?? []), i]);
  const canonicalOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const group of groups.values()) {
    const [canonical] = [...group].sort(
      (a, b) =>
        Number(b.published) - Number(a.published) ||
        Number(b.usEligible) - Number(a.usEligible) ||
        a.firstSeenAt.localeCompare(b.firstSeenAt) ||
        a.id.localeCompare(b.id),
    );
    members.set(canonical.id, group.map((g) => g.id).sort());
    for (const g of group) canonicalOf.set(g.id, canonical.id);
  }
  const possibleDuplicates = [...looseGroups.values()]
    .map((ids) => [...new Set(ids.map((id) => canonicalOf.get(id)!))])
    .filter((canon) => canon.length > 1);
  return { canonicalOf, members, possibleDuplicates };
}
