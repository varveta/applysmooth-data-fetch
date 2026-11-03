import { setTimeout as sleep } from "node:timers/promises";
import { getonboard, GetonboardPage, getonboardUrl } from "../../src/lib/jobs-ingest/getonboard";
import { getJson } from "./http";

const MAX_PAGES = 25;
/** Public search is an observation window, never evidence that absent jobs closed. */
export async function loadGetonboardBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
  wait: (ms: number) => Promise<unknown> = sleep,
) {
  const first = getonboard.listUrl(target.tenant);
  const jobs = [], ids = new Set<string>();
  let totalPages: number | undefined, attempts = 0, bytes = 0, pages = 0;
  for (let page = 1; page <= Math.min(totalPages ?? 1, MAX_PAGES); page++) {
    if (page > 1) await wait(1000);
    const url = new URL(first);
    url.searchParams.set("page", String(page));
    const response = await get(url.href, { attempts: 2, timeoutMs: 20_000, maxBytes: 12_000_000 });
    if (!response.ok) throw new Error(response.error);
    attempts += response.attempts; bytes += response.bytes; pages++;
    const parsed = GetonboardPage.parse(response.body), meta = parsed.meta;
    if (meta.page !== page || meta.per_page !== 10 ||
        (totalPages !== undefined && meta.total_pages !== totalPages))
      throw new Error("Get on Board pagination changed");
    totalPages = meta.total_pages;
    if ((totalPages === 0 && parsed.data.length !== 0) ||
        (totalPages > 0 && parsed.data.length === 0) ||
        (page < totalPages && parsed.data.length !== meta.per_page) ||
        parsed.data.length > meta.per_page)
      throw new Error("Incomplete Get on Board page");
    for (const job of parsed.data) {
      if (ids.has(job.id)) throw new Error("Duplicate Get on Board identity");
      getonboardUrl(job.links.public_url, job.id);
      ids.add(job.id); jobs.push(job);
    }
  }
  return { body: jobs, attempts, bytes,
    discovery: { policy: "observations" as const, pages, capped: (totalPages ?? 0) > MAX_PAGES } };
}
