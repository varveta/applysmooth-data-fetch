import { z } from "zod";
import type { FetchResult } from "./http";

export type FeedStatusCheck = {
  status: "open" | "closed" | "uncertain";
  http_status?: number;
  detail: string;
};

const JobicyStatus = z.object({
  success: z.literal(true), statusCode: z.literal(200),
  checkedAt: z.string().datetime({ offset: true }),
  count: z.number().int().min(1).max(100),
  jobs: z.array(z.object({
    id: z.number().int().positive().safe(),
    // Jobicy reports expiry as "closed". Undocumented status values are not closure evidence.
    status: z.enum(["active", "closed", "unknown"]),
  })).min(1).max(100),
});

function validId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
}

/**
 * Jobicy's status API covers stored jobs beyond the seven-day discovery window.
 * Each queued group shares one lazy request, including when many checks start together.
 * An incomplete response invalidates the whole batch before any closure is emitted.
 */
export function createJobicyVerifier(
  queuedJobs: Array<{ source: string; source_job_id: string }>,
  read: (url: string) => Promise<FetchResult>,
): (id: string) => Promise<FeedStatusCheck> {
  type Batch = { ids: string[]; promise?: Promise<Map<string, FeedStatusCheck>> };
  const batchesById = new Map<string, Batch>();
  const queuedIds = [...new Set(queuedJobs.filter((job) => job.source === "jobicy" && validId(job.source_job_id))
    .map((job) => job.source_job_id))];
  for (let start = 0; start < queuedIds.length; start += 100) {
    const batch: Batch = { ids: queuedIds.slice(start, start + 100) };
    for (const id of batch.ids) batchesById.set(id, batch);
  }

  const run = async (ids: string[]): Promise<Map<string, FeedStatusCheck>> => {
    let httpStatus: number | undefined;
    const uncertain = (detail: string) => new Map(ids.map((id) => [id, {
      status: "uncertain" as const, ...(httpStatus === undefined ? {} : { http_status: httpStatus }), detail,
    }]));
    const url = new URL("https://jobicy.com/api/jobs/status");
    url.searchParams.set("ids", ids.join(","));
    try {
      const response = await read(url.toString());
      httpStatus = response.status ?? undefined;
      // A 404/410 here concerns the batch endpoint, never an individual vacancy.
      if (!response.ok || response.status !== 200)
        return uncertain("Jobicy status endpoint unavailable; closure withheld");
      const parsed = JobicyStatus.safeParse(response.body);
      if (!parsed.success) return uncertain("Jobicy status response malformed; closure withheld");
      const body = parsed.data;
      const returned = new Set(body.jobs.map((job) => String(job.id)));
      if (body.count !== ids.length || body.jobs.length !== ids.length || returned.size !== ids.length || ids.some((id) => !returned.has(id)))
        return uncertain("Jobicy status response incomplete or mismatched; closure withheld");
      return new Map(body.jobs.map((job) => [String(job.id), {
        status: job.status === "active" ? "open" as const : job.status === "closed" ? "closed" as const : "uncertain" as const,
        http_status: 200,
        detail: job.status === "active" ? "Jobicy confirms posting remains active"
          : job.status === "closed" ? "Jobicy explicitly confirms posting closed or expired"
            : "Jobicy cannot confirm posting status; closure withheld",
      }]));
    } catch {
      return uncertain("Jobicy status request failed; closure withheld");
    }
  };

  return async (id) => {
    if (!validId(id)) return { status: "uncertain", detail: "Invalid Jobicy posting ID; status not requested" };
    let batch = batchesById.get(id);
    if (!batch) {
      // Direct verifier callers may not supply a queue. Preserve request sharing for these IDs too.
      batch = { ids: [id] };
      batchesById.set(id, batch);
    }
    batch.promise ??= run(batch.ids);
    return (await batch.promise).get(id) ?? { status: "uncertain", detail: "Jobicy posting status missing; closure withheld" };
  };
}
