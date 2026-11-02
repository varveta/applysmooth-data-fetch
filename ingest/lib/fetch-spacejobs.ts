import { parseSpacejobsXml, spacejobs } from "../../src/lib/jobs-ingest/spacejobs";
import { getJson } from "./http";

/** One disclosed observation page; absence from this window never proves closure. */
export async function loadSpacejobsBoard(target: { tenant: string }, get: typeof getJson = getJson,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const url = spacejobs.listUrl(target.tenant);
  const options = { responseType: "text" as const, accept: "application/xml", redirect: "error" as const,
    maxBytes: 20_000_000, timeoutMs: 30_000, attempts: 1 };
  let response = await get(url, options), attempts = response.attempts;
  if (!response.ok && response.retryable) {
    // The feed asks for at least one minute after 503. Keep the shared helper's
    // randomized shorter retries disabled and perform at most one retry here.
    await pause(60_000);
    response = await get(url, options);
    attempts += response.attempts;
  }
  if (!response.ok) throw new Error(response.error);
  const feed = parseSpacejobsXml(response.body);
  return { body: feed.jobs, attempts, bytes: response.bytes,
    discovery: { policy: "observations" as const, pages: 1, capped: true, maximum_jobs: 600,
      reported_total: feed.total, reported_pages: feed.pages, publication_dates: "unknown_mixed_with_first_seen" } };
}
