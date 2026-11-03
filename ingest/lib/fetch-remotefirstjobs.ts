import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { RemoteFirstJobsListing, RemoteFirstJobsPage, remotefirstjobs } from "../../src/lib/jobs-ingest/remotefirstjobs";
import { getJson } from "./http";

/** Rolling observations only. Missing IDs never establish posting closure. */
export async function loadRemotefirstjobsBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
  options: { maxPages?: number; wait?: (ms: number) => Promise<unknown> } = {},
) {
  const maxPages = z.number().int().min(1).max(5).parse(options.maxPages ?? 1);
  const url = new URL(remotefirstjobs.listUrl(target.tenant));
  const wait = options.wait ?? sleep;
  const jobs: z.infer<typeof RemoteFirstJobsListing> = [];
  const ids = new Set<string>();
  let attempts = 0, bytes = 0, pages = 0, capped = false;
  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await wait(1000);
    url.searchParams.set("page", String(page));
    const response = await get(url.href, { attempts: 2, timeoutMs: 20_000, maxBytes: 4_000_000,
      baseDelayMs: 1000, redirect: "error" });
    attempts += response.attempts;
    if (!response.ok) throw new Error(response.error);
    if (response.status !== 200) throw new Error(`Unexpected Remote First Jobs HTTP ${response.status}`);
    bytes += response.bytes;
    const result = RemoteFirstJobsPage.parse(response.body);
    if (result.page !== page) throw new Error("Remote First Jobs page identity mismatch");
    for (const job of result.jobs) {
      if (ids.has(job.id)) throw new Error("Duplicate Remote First Jobs identity across pages");
      ids.add(job.id); jobs.push(job);
    }
    pages++;
    capped = result.jobs.length === 100;
    if (!capped) break;
  }
  return { body: jobs, attempts, bytes,
    discovery: { policy: "observations" as const, pages, capped, maximum_jobs: maxPages * 100,
      publication_dates: "unknown_original_provenance" } };
}
