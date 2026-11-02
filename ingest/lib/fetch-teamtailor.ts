import { setTimeout as sleep } from "node:timers/promises";
import { parseTeamtailorXml, teamtailor, type TeamtailorPosting } from "../../src/lib/jobs-ingest/teamtailor";
import type { z } from "zod";
import { getJson } from "./http";

const MAX_PAGES = 10;
/** RSS pagination is an observation window: missing jobs never imply closure. */
export async function loadTeamtailorBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
  wait: (ms: number) => Promise<unknown> = sleep,
) {
  const first = teamtailor.listUrl(target.tenant);
  const jobs: z.infer<typeof TeamtailorPosting>[] = [], ids = new Set<string>(), numericIds = new Set<string>();
  let company: string | undefined, attempts = 0, bytes = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await wait(1000);
    const url = new URL(first);
    url.searchParams.set("offset", String(page * 100));
    const response = await get(url.href, {
      attempts: 2, timeoutMs: 20_000, maxBytes: 12_000_000,
      responseType: "text", accept: "application/rss+xml, application/xml, text/xml", redirect: "error",
    });
    if (!response.ok) throw new Error(response.error);
    attempts += response.attempts; bytes += response.bytes;
    const parsed = parseTeamtailorXml(response.body, target.tenant);
    if (company !== undefined && company !== parsed.company) throw new Error("Teamtailor channel changed during pagination");
    company = parsed.company;
    for (const job of parsed.jobs) {
      const numericId = new URL(job.link).pathname.split("/")[2].split("-")[0];
      if (ids.has(job.guid) || numericIds.has(numericId)) throw new Error("Duplicate Teamtailor identity across pages");
      ids.add(job.guid); numericIds.add(numericId); jobs.push(job);
    }
    if (parsed.jobs.length < 100) return { body: jobs, attempts, bytes,
      discovery: { policy: "observations" as const, pages: page + 1, capped: false } };
  }
  return { body: jobs, attempts, bytes,
    discovery: { policy: "observations" as const, pages: MAX_PAGES, capped: true } };
}
