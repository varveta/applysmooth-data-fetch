import { z } from "zod";
import { ATS_ADAPTERS, SmartRecruitersJobSchema } from "@/lib/jobs-ingest/ats-adapters";
import type { SourceId } from "@/lib/jobs-ingest/contract";
import { getJson, hostLimiter } from "./http";

const requests = hostLimiter();
const tenantSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,119}$/i);
const postingId = z.union([z.string(), z.number().int().safe()]).transform(String)
  .pipe(z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/));
const pageSchema = z.object({
  offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
  totalFound: z.number().int().nonnegative().max(50_000),
  content: z.array(z.object({ id: postingId })).max(100),
});

/** Fetch only supported public APIs. Any partial page/detail failure rejects the snapshot. */
export async function loadAtsBoard(
  target: { source: SourceId; tenant: string; company: string },
  get: typeof getJson,
): Promise<{ body: unknown; attempts: number; bytes: number }> {
  if (!(target.source in ATS_ADAPTERS)) throw new Error(`Unsupported ATS source: ${target.source}`);
  const tenant = tenantSchema.parse(target.tenant);
  const adapter = ATS_ADAPTERS[target.source as keyof typeof ATS_ADAPTERS];
  let attempts = 0;
  let bytes = 0;
  const read = async (url: string, responseType: "json" | "text" = "json") => {
    const response = await requests.run(url, () => get(url, { responseType }));
    attempts += response.attempts;
    if (!response.ok) throw Object.assign(new Error(`ATS request failed (${response.status ?? "network"}): ${response.error}`), {
      status: response.status, attempts, bytes,
    });
    bytes += response.bytes;
    return response.body;
  };
  if (target.source !== "smartrecruiters") {
    // Recruitee requires employer Careers API tokens starting 2027-02-10.
    // A 401 fails this board; never retry through an alternate/private endpoint.
    const body = await read(adapter.listUrl(tenant), target.source === "personio" ? "text" : "json");
    adapter.parseListing(body);
    return { body, attempts, bytes };
  }

  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(tenant)}/postings`;
  const ids: string[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let offset = 0; total === undefined || offset < total; offset += 100) {
    const page = pageSchema.parse(await read(`${base}?limit=100&offset=${offset}&destination=PUBLIC`));
    if (page.offset !== offset || page.limit !== 100) throw new Error("SmartRecruiters returned an unexpected page offset/limit");
    if (total !== undefined && page.totalFound !== total) throw new Error("SmartRecruiters total changed during pagination");
    total = page.totalFound;
    if (page.content.length !== Math.min(100, total - offset)) throw new Error("SmartRecruiters incomplete page or total mismatch");
    for (const row of page.content) {
      if (seen.has(row.id)) throw new Error(`SmartRecruiters repeated posting ID: ${row.id}`);
      seen.add(row.id);
      ids.push(row.id);
    }
  }
  if (ids.length !== total) throw new Error("SmartRecruiters snapshot does not match totalFound");

  const details = await Promise.allSettled(ids.map(async (id) => {
    // Never follow API-provided refs: the host, tenant and ID are constrained here.
    const body = await read(`${base}/${encodeURIComponent(id)}`);
    const detail = SmartRecruitersJobSchema.parse(body);
    if (detail.id !== id || detail.company.identifier?.toLowerCase() !== tenant.toLowerCase()) {
      throw new Error(`SmartRecruiters detail identity mismatch: ${id}`);
    }
    return detail;
  }));
  const failed = details.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  const jobs = details.map((result) => {
    if (result.status !== "fulfilled") throw new Error("SmartRecruiters detail missing");
    return result.value;
  });
  const body = { jobs };
  adapter.parseListing(body);
  return { body, attempts, bytes };
}
