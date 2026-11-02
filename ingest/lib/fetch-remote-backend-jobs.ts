import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { REMOTE_BACKEND_ORIGIN, RemoteBackendPosting, RemoteBackendSummary, remotebackendjobs } from "../../src/lib/jobs-ingest/remote-backend-jobs";
import { getJson } from "./http";
import { CollectorError } from "./diagnostics";

/** Public API window only. All three network boards count as one source. */
export async function loadRemoteBackendJobsBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
  options: { maxJobs?: number; wait?: (ms: number) => Promise<unknown> } = {},
) {
  // Offset pages can overlap while new jobs arrive. Default to one bounded
  // observation window; larger diagnostic windows must still reject overlap.
  const budget = z.number().int().min(1).max(250).parse(options.maxJobs ?? 50);
  const base = remotebackendjobs.listUrl(target.tenant);
  const wait = options.wait ?? sleep;
  const listings: z.infer<typeof RemoteBackendSummary>[] = [];
  const seen = new Set<string>();
  let attempts = 0, bytes = 0, pages = 0, capped = false;
  const read = async (url: string, maxBytes: number) => {
    // Serial spacing plus retry backoff remains below the documented 120/min limit.
    await wait(600);
    const response = await get(url, { attempts: 2, timeoutMs: 20_000, maxBytes, baseDelayMs: 1000, redirect: "error" });
    attempts += response.attempts;
    if (!response.ok) throw new Error(response.error);
    bytes += response.bytes;
    pages++;
    return response.body;
  };
  for (let offset = 0; offset < budget;) {
    const limit = Math.min(50, budget - offset), url = new URL(base);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const page = z.array(RemoteBackendSummary).max(limit).parse(await read(url.href, 8_000_000));
    for (const job of page) {
      if (seen.has(job.id)) throw new CollectorError("Remote Backend Jobs repeated pagination identity");
      seen.add(job.id); listings.push(job);
    }
    if (page.length < limit) break;
    offset += limit;
    capped = offset === budget;
  }
  const detailed: z.infer<typeof RemoteBackendPosting>[] = [];
  for (const summary of listings) {
    const detail = RemoteBackendPosting.parse(await read(`${REMOTE_BACKEND_ORIGIN}/api/jobs/${summary.id}`, 2_000_000));
    if (detail.id !== summary.id || detail.title !== summary.title || detail.link !== summary.link ||
        detail.isoDate !== summary.isoDate || detail.location !== summary.location)
      throw new CollectorError("Remote Backend Jobs detail changed or mismatched identity");
    if (detail.reviewPending) throw new CollectorError("Unreviewed Remote Backend Jobs posting");
    detailed.push(detail);
  }
  return { body: detailed, attempts, bytes,
    discovery: { policy: "observations" as const, pages, capped, maximum_jobs: budget } };
}
