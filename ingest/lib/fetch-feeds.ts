import { FEED_ADAPTERS } from "@/lib/jobs-ingest/feed-adapters";
import type { SourceId } from "@/lib/jobs-ingest/contract";
import { getJson } from "./http";

/** Discovery budgets, never evidence that unseen jobs have closed. */
export const MAX_FEED_PAGES = 10;
export type FeedDiscovery = { policy: "observations"; pages: number; capped: boolean };

export async function loadFeedBoard(
  target: { source: SourceId; tenant: string; company: string },
  get: typeof getJson,
): Promise<{ body: unknown; attempts: number; bytes: number; discovery: FeedDiscovery }> {
  if (!Object.hasOwn(FEED_ADAPTERS, target.source)) throw new Error(`Unsupported feed source: ${target.source}`);
  const adapter = FEED_ADAPTERS[target.source as keyof typeof FEED_ADAPTERS];
  const initial = new URL(adapter.listUrl(target.tenant));
  const expectedOrigin = initial.origin;
  let attempts = 0;
  let bytes = 0;
  let pages = 0;
  const read = async (url: URL) => {
    if (url.origin !== expectedOrigin || url.username || url.password)
      throw new Error("Feed pagination cannot change provider origin");
    const response = await get(url.toString(), {
      responseType: target.source === "weworkremotely" ? "text" : "json",
      maxBytes: 12_000_000,
    });
    attempts += response.attempts;
    if (!response.ok) throw new Error(`${target.source} feed page ${pages + 1}: ${response.error}`);
    bytes += response.bytes;
    pages++;
    // Validate the entire response before retaining any part of this board run.
    const jobs = adapter.parseListing(response.body);
    return { body: response.body, jobs };
  };
  const first = await read(initial);
  if (target.source !== "jobicy" && target.source !== "himalayas") {
    return { body: first.body, attempts, bytes, discovery: { policy: "observations", pages, capped: false } };
  }

  const jobs: unknown[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let current = first;
  let capped = false;
  let estimatedTotal = 0;
  for (;;) {
    const envelope = current.body as Record<string, unknown>;
    for (const job of current.jobs) {
      const id = adapter.postingId(job);
      // Search pages can shift. Fail this run instead of presenting a misleading complete traversal.
      if (ids.has(id)) throw new Error(`Duplicate ${target.source} posting across feed pages: ${id}`);
      ids.add(id);
      jobs.push(job);
    }
    if (target.source === "himalayas") estimatedTotal = Math.max(estimatedTotal, envelope.totalCount as number);
    let next: URL;
    if (target.source === "jobicy") {
      const cursor = envelope.nextCursor as string | null;
      if (cursor === null) break;
      if (cursors.has(cursor)) throw new Error("Repeated Jobicy cursor");
      cursors.add(cursor);
      next = new URL(initial);
      // Treat cursors as opaque values, never executable pagination URLs.
      next.searchParams.set("cursor", cursor);
    } else {
      // A short page and an estimated total are not end-of-feed signals for Himalayas.
      if (current.jobs.length === 0) break;
      next = new URL(initial);
      next.searchParams.set("page", String(pages + 1));
    }
    if (pages >= MAX_FEED_PAGES) { capped = true; break; }
    current = await read(next);
  }
  const discovery: FeedDiscovery = { policy: "observations", pages, capped };
  const last = current.body as Record<string, unknown>;
  const body = target.source === "jobicy"
    ? { ...last, jobs, jobCount: jobs.length, discovery }
    : { ...last, jobs, totalCount: estimatedTotal, discovery };
  adapter.parseListing(body);
  return { body, attempts, bytes, discovery };
}
