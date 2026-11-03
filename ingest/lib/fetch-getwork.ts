import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { GETWORK_ORIGIN, GetworkPage, GetworkPosting, getwork, getworkJobUrl } from "../../src/lib/jobs-ingest/getwork";
import { getJson } from "./http";

/** One deliberately bounded fresh-US observation window, never an absence/closure feed. */
export async function loadGetworkBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
  options: { maxJobs?: number; wait?: (ms: number) => Promise<unknown> } = {},
) {
  const budget = z.number().int().min(1).max(50).parse(options.maxJobs ?? 20);
  const first = new URL(getwork.listUrl(target.tenant));
  first.searchParams.set("limit", String(budget));
  const wait = options.wait ?? sleep;
  let attempts = 0, bytes = 0, requests = 0;
  const read = async (url: string, maxBytes: number) => {
    if (requests > 0) await wait(1000);
    requests++;
    const response = await get(url, { attempts: 2, timeoutMs: 20_000, maxBytes, baseDelayMs: 1000, redirect: "error" });
    attempts += response.attempts;
    if (!response.ok) throw new Error(response.error);
    bytes += response.bytes;
    return response.body;
  };
  const page = GetworkPage.parse(await read(first.href, 2_000_000));
  if (page.jobs.length !== Math.min(budget, page.total)) throw new Error("Incomplete Getwork observation window");
  const ids = new Set<string>();
  for (const job of page.jobs) {
    if (ids.has(job.id)) throw new Error("Duplicate Getwork identity");
    ids.add(job.id); getworkJobUrl(job.getwork_url, job.id);
  }
  const jobs: z.infer<typeof GetworkPosting>[] = [];
  for (const summary of page.jobs) {
    // Construct detail URLs from validated IDs, never follow a supplied URL.
    const job = GetworkPosting.parse(await read(`${GETWORK_ORIGIN}/api/jobs/${summary.id}/`, 2_000_000));
    getworkJobUrl(job.getwork_url, job.id);
    if (job.id !== summary.id || job.title !== summary.title || job.company.name !== summary.company.name ||
        job.company.slug !== summary.company.slug || job.getwork_url !== summary.getwork_url ||
        job.apply_url !== summary.apply_url || job.published_at !== summary.published_at ||
        job.location !== summary.location || job.remote !== summary.remote)
      throw new Error("Getwork detail identity changed or mismatched");
    if (!job.active) throw new Error("Inactive Getwork posting");
    jobs.push(job);
  }
  return { body: jobs, attempts, bytes,
    discovery: { policy: "observations" as const, pages: requests, capped: page.total > budget, maximum_jobs: budget } };
}
