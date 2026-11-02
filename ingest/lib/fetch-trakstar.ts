import { z } from "zod";
import { trakstarDetail } from "./trakstar-detail";
import {
  trakstar,
  TrakstarPage,
  trakstarUrl,
} from "../../src/lib/jobs-ingest/trakstar";
import { getJson } from "./http";
/** Public frontend API. Never read applicant data or submit an application. */
export async function loadTrakstarBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
) {
  const base = trakstar.listUrl(target.tenant),
    jobs = [],
    seen = new Set<string>();
  let total: number | undefined,
    attempts = 0,
    bytes = 0,
    pages = 0;
  for (let offset = 0; total === undefined || offset < total; ) {
    if (pages >= 500) throw new Error("Trakstar pagination cap exceeded");
    const url = new URL(base);
    url.searchParams.set("offset", String(offset));
    const r = await get(url.href, {
      attempts: 2,
      timeoutMs: 20_000,
      maxBytes: 12_000_000,
    });
    if (!r.ok) throw new Error(r.error);
    attempts += r.attempts;
    bytes += r.bytes;
    pages++;
    const p = TrakstarPage.parse(r.body),
      count = p.meta.total ?? p.meta.total_count!;
    if (p.meta.offset !== offset || (total !== undefined && total !== count))
      throw new Error("Trakstar offset or total changed");
    total = count;
    if (total > 500) throw new Error("Trakstar detail request budget exceeded");
    if (p.objects.length !== Math.min(p.meta.limit, total - offset))
      throw new Error("Incomplete Trakstar page");
    for (const j of p.objects) {
      if (j.client_name !== target.tenant || seen.has(j.id))
        throw new Error("Trakstar conflicting identity");
      trakstarUrl(j.hosted_url, target.tenant, j.id);
      seen.add(j.id);
      jobs.push(j);
    }
    offset += p.meta.limit;
  }
  if (jobs.length !== total) throw new Error("Incomplete Trakstar snapshot");
  const detailed = [];
  for (const j of jobs) {
    const r = await get(trakstarUrl(j.hosted_url, target.tenant, j.id), {
      responseType: "text",
      attempts: 1,
      timeoutMs: 20_000,
      maxBytes: 2_000_000,
    });
    if (!r.ok) throw new Error(r.error);
    attempts += r.attempts;
    bytes += r.bytes;
    const d = trakstarDetail(z.string().parse(r.body), j.id, j.title);
    detailed.push({
      ...j,
      detail_posted_at: d.datePosted,
      detail_expires_at: d.validThrough,
    });
  }
  return {
    body: detailed,
    attempts,
    bytes,
    discovery: {
      policy: "observations" as const,
      pages: pages + jobs.length,
      capped: false,
    },
  };
}
