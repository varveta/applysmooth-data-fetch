import { parseRailsJobsXml, railsjobs, RAILS_JOBS_MAX_ITEMS } from "../../src/lib/jobs-ingest/rails-jobs";
import { getJson } from "./http";

/** One provider-selected RSS window. An absent item is never closure evidence. */
export async function loadRailsJobsBoard(target: { tenant: string }, get: typeof getJson = getJson) {
  const result = await get(railsjobs.listUrl(target.tenant), {
    attempts: 2, timeoutMs: 20_000, maxBytes: 12_000_000,
    responseType: "text", accept: "application/rss+xml, application/xml, text/xml", redirect: "error",
  });
  if (!result.ok) throw new Error(result.error);
  return {
    body: parseRailsJobsXml(result.body), attempts: result.attempts, bytes: result.bytes,
    discovery: { policy: "observations" as const, pages: 1, capped: true, maximum_jobs: RAILS_JOBS_MAX_ITEMS },
  };
}
