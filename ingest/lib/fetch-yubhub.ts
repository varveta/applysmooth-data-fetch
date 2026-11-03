import { YubhubFeed, YubhubPosting, yubhub, yubhubEmployerUrl, hydrateYubhubPosting } from "../../src/lib/jobs-ingest/yubhub";
import { getJson } from "./http";

/** Bounded discovery only; enriched feed text is never ingested as an original JD. */
export async function loadYubhubBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  let attempts = 0, bytes = 0;
  const first = await get(yubhub.listUrl(target.tenant), {
    attempts: 2, timeoutMs: 20_000, maxBytes: 8_000_000, redirect: "error",
  });
  if (!first.ok) throw new Error(first.error);
  attempts += first.attempts; bytes += first.bytes;
  const feed = YubhubFeed.parse(first.body), ids = new Set<string>(), urls = new Set<string>();
  // Validate the whole discovery envelope before any detail request.
  for (const item of feed.jobs) {
    const url = yubhubEmployerUrl(item.url);
    if (yubhubEmployerUrl(item["x-apply-url"]) !== url || ids.has(item.identifier.value) || urls.has(url))
      throw new Error("Duplicate or conflicting YubHub discovery identity");
    ids.add(item.identifier.value); urls.add(url);
  }
  const jobs = [];
  for (const item of feed.jobs) {
    await pause(750);
    const response = await get(yubhubEmployerUrl(item.url), {
      attempts: 2, timeoutMs: 20_000, maxBytes: 2_000_000,
      responseType: "text", accept: "text/html", redirect: "error",
    });
    attempts += response.attempts;
    if (!response.ok) {
      jobs.push(YubhubPosting.parse({ ...item, original: null, hydration_error: "detail_unavailable" }));
      continue;
    }
    bytes += response.bytes;
    if (bytes > 40_000_000) throw new Error("YubHub aggregate response budget exceeded");
    if (typeof response.body !== "string") throw new Error("Workday detail must be HTML");
    jobs.push(hydrateYubhubPosting(item, response.body));
  }
  return { body: jobs, attempts, bytes,
    discovery: { policy: "observations" as const, pages: 1 + jobs.length, capped: true },
  };
}
