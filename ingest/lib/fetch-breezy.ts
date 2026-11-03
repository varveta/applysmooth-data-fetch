import { Parser } from "htmlparser2";
import { CollectorError } from "./diagnostics";
import { z } from "zod";
import { breezy, breezyUrl, parseBreezyList } from "../../src/lib/jobs-ingest/breezy";
import { getJson } from "./http";

const detail = z.object({ "@type": z.literal("JobPosting"), url: z.string().url(),
  description: z.string().min(1).max(100_000), datePosted: z.string().nullish(), validThrough: z.string().nullish() });
export function breezyDetail(html: string, tenant: string, id: string, expectedUrl: string) {
  const matches: z.infer<typeof detail>[] = [];
  for (const block of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: unknown;
    try { json = JSON.parse(block[1]); } catch { continue; }
    for (const candidate of Array.isArray(json) ? json : [json]) {
      const parsed = detail.safeParse(candidate);
      if (parsed.success && breezyUrl(parsed.data.url, tenant, id) === expectedUrl) matches.push(parsed.data);
    }
  }
  if (matches.length > 1) throw new CollectorError("Missing or ambiguous Breezy job details");
  if (matches.length === 1) return matches[0];
  // Older public templates omit JSON-LD; parse the exact description container
  // and require a matching canonical posting plus its application link.
  const canonical: string[] = [], descriptions: string[] = [];
  let depth = 0, capture: { depth: number; start: number } | undefined, application = false;
  const parser = new Parser({
    onopentag(name, attributes) {
      depth++;
      if (name === "link" && attributes.rel === "canonical") canonical.push(attributes.href);
      if (name === "a" && attributes.href) {
        const u = new URL(attributes.href, expectedUrl);
        if (u.origin === new URL(expectedUrl).origin && u.pathname === new URL(expectedUrl).pathname + "/apply") application = true;
      }
      if (name === "div" && attributes.class?.split(/\s+/).includes("description")) {
        if (capture) throw new CollectorError("Nested Breezy description containers");
        capture = { depth, start: parser.endIndex + 1 };
      }
    },
    onclosetag() {
      if (capture?.depth === depth) {
        descriptions.push(html.slice(capture.start, parser.startIndex));
        capture = undefined;
      }
      depth--;
    },
  }, { decodeEntities: true });
  parser.write(html); parser.end();
  if (canonical.length !== 1 || breezyUrl(canonical[0], tenant, id) !== expectedUrl ||
      !application || descriptions.length !== 1 || !descriptions[0].trim())
    throw new CollectorError("Missing or ambiguous Breezy job details");
  return detail.parse({ "@type": "JobPosting", url: expectedUrl, description: descriptions[0] });
}

/** One public list and bounded sequential detail reads; failure invalidates this board. */
export async function loadBreezyBoard(target: { tenant: string; company: string }, get: typeof getJson = getJson) {
  const list = await get(breezy.listUrl(target.tenant), { maxBytes: 12_000_000, attempts: 1, timeoutMs: 20_000 });
  if (!list.ok) throw new Error(list.error);
  const jobs = parseBreezyList(list.body);
  // Validate every URL before following any payload-supplied link.
  const urls = jobs.map(j => breezyUrl(j.url, target.tenant, j.id));
  let attempts = list.attempts, bytes = list.bytes;
  const body = [];
  for (const [index, j] of jobs.entries()) {
    const page = await get(urls[index], { responseType: "text", maxBytes: 2_000_000, attempts: 1, timeoutMs: 20_000 });
    if (!page.ok) throw new Error(page.error);
    attempts += page.attempts; bytes += page.bytes;
    const d = breezyDetail(z.string().parse(page.body), target.tenant, j.id, urls[index]);
    body.push({ ...j, description: d.description, detail_posted_at: d.datePosted, detail_expires_at: d.validThrough });
  }
  return { body, attempts, bytes, discovery: { policy: "observations" as const, pages: 1 + jobs.length, capped: false } };
}
