import { manatal, ManatalPage } from "../../src/lib/jobs-ingest/manatal";
import { getJson } from "./http";

/** Documented public career API only. Partial/changed/repeated snapshots fail closed. */
export async function loadManatalBoard(target: { tenant: string }, get: typeof getJson = getJson) {
  const first = manatal.listUrl(target.tenant);
  const path = new URL(first).pathname;
  let url: string | null = first, total: number | undefined, attempts = 0, bytes = 0, pages = 0;
  const jobs = [], ids = new Set<number>(), hashes = new Set<string>(), visited = new Set<string>();
  while (url) {
    const u = new URL(url);
    if (u.origin !== "https://api.manatal.com" || u.pathname !== path || u.username || u.password || u.port ||
        u.hash || visited.has(u.href) || pages >= 100)
      throw new Error("Invalid Manatal pagination");
    visited.add(u.href);
    const response = await get(u.href, { maxBytes: 12_000_000, timeoutMs: 20_000, attempts: 2 });
    if (!response.ok) throw new Error(response.error);
    attempts += response.attempts; bytes += response.bytes; pages++;
    const page = ManatalPage.parse(response.body);
    if (total !== undefined && page.count !== total) throw new Error("Manatal count changed during pagination");
    total = page.count;
    for (const job of page.results) {
      if (ids.has(job.id) || hashes.has(job.hash)) throw new Error("Duplicate Manatal posting identity");
      ids.add(job.id); hashes.add(job.hash); jobs.push(job);
    }
    if (jobs.length > total || (page.next && (!page.results.length || jobs.length >= total)))
      throw new Error("Incomplete Manatal snapshot");
    url = page.next;
  }
  if (jobs.length !== total) throw new Error("Incomplete Manatal snapshot");
  // Transport completeness does not establish permission to close missing jobs.
  return { body: jobs, attempts, bytes, discovery: { policy: "observations" as const, pages, capped: false } };
}
