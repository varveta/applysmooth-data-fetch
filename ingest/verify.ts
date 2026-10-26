import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { SOURCE_IDS } from "@/lib/jobs-ingest/contract";
import { assertRunnerContext, clientFromEnv, type RequestMetrics } from "./lib/collector-client";
import { CollectorError, errorLine, eventLine, safeReason, type Stage } from "./lib/diagnostics";
import { getJson, hostLimiter, USER_AGENT } from "./lib/http";

const count = z.number().int().nonnegative().safe();
export const VerifyJobSchema = z.object({
  id: z.string().min(1).max(250), source: z.enum(SOURCE_IDS),
  tenant: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  source_job_id: z.string().min(1).max(120),
  apply_url: z.string().max(2000), reason: z.string().min(1).max(120),
});
export type VerifyJob = z.infer<typeof VerifyJobSchema>;
type Check = { status: "open" | "closed" | "link_broken" | "uncertain"; http_status?: number; detail: string };
export type VerificationResult = Check & { id: string; stage: "verify_source" | "verify_link" };

function publicLink(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
        !url.hostname.includes(".") || /\.(?:localhost|local|internal)$/i.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function genericDestination(url: URL) {
  // Common board roots can still address a posting via its query parameter.
  for (const key of ["gh_jid", "job_id", "jobId", "jid", "reqId", "requisitionId"])
    if (url.searchParams.get(key)) return false;
  const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (parts[0] && /^[a-z]{2}(?:-[a-z]{2})?$/.test(parts[0])) parts.shift();
  if (!parts.length) return true;
  if (/^(?:jobs|boards|job-boards)\.(?:ashbyhq\.com|lever\.co|greenhouse\.io)$/.test(url.hostname) && parts.length <= 1) return true;
  return /(?:^|\/)(?:careers?|jobs?|join-us|join-our-team|work-with-us|opportunities|openings|positions|login|signin)(?:\.html?)?(?:\/(?:search|all|openings|jobs|positions))?\/?$/.test(parts.join("/"));
}

function dnsNotFound(error: unknown): boolean {
  for (let depth = 0; error && depth < 5; depth++) {
    if (typeof error !== "object") return false;
    const value = error as { code?: unknown; cause?: unknown };
    if (value.code === "ENOTFOUND" || value.code === "EAI_NONAME") return true;
    error = value.cause;
  }
  return false;
}

export function verifier(options: { perHost?: number; concurrency?: number; queuedJobs?: VerifyJob[] } = {}) {
  const limiter = hostLimiter(options.concurrency, options.perHost);
  const queuedIds = new Map<string, Set<string>>();
  for (const job of options.queuedJobs ?? []) {
    if (job.source !== "ashby") continue;
    const ids = queuedIds.get(job.tenant) ?? new Set<string>();
    ids.add(job.source_job_id);
    queuedIds.set(job.tenant, ids);
  }
  const ashbyBoards = new Map<string, Promise<{ ids: Set<string> } | Check>>();
  const metrics = { requests: 0 };
  const read = async (url: string) => limiter.run(url, async () => {
    // A failed daily check is uncertain; next run retries. No minute-long backoff per job.
    const result = await getJson(url, { attempts: 1, timeoutMs: 15_000 });
    metrics.requests += result.attempts;
    return result;
  });
  const source = async (job: VerifyJob): Promise<Check> => {
    if (job.source === "ashby") {
      let pending = ashbyBoards.get(job.tenant);
      if (!pending) {
        pending = (async () => {
          const response = await read(ADAPTERS.ashby.listUrl(job.tenant));
          if (!response.ok) return { status: "uncertain" as const, ...(response.status ? { http_status: response.status } : {}), detail: `Source board: ${safeReason(new Error(response.error))}` };
          try {
            const listing = ADAPTERS.ashby.parseListing(response.body);
            // Validate every identity before absence can mean closed.
            const ids = new Set(listing.map((raw) => ADAPTERS.ashby.postingId(raw)));
            // An empty or implausibly small snapshot cannot bypass fetch-pipeline guards.
            if (!ids.size || ids.size * 2 < (queuedIds.get(job.tenant)?.size ?? 0))
              return { status: "uncertain" as const, http_status: response.status, detail: "Source board empty or unexpectedly small; closure withheld" };
            return { ids };
          } catch { return { status: "uncertain" as const, detail: "Source board validation failed" }; }
        })();
        ashbyBoards.set(job.tenant, pending);
      }
      const board = await pending;
      if (!("ids" in board)) return board;
      return board.ids.has(job.source_job_id)
        ? { status: "open", http_status: 200, detail: "Source confirms posting" }
        : { status: "closed", http_status: 200, detail: "Absent from complete source board" };
    }
    const tenant = encodeURIComponent(job.tenant), id = encodeURIComponent(job.source_job_id);
    const url = job.source === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${tenant}/jobs/${id}`
      : `https://api.lever.co/v0/postings/${tenant}/${id}?mode=json`;
    const response = await read(url);
    if (!response.ok) {
      if (response.status === 404 || response.status === 410)
        return { status: "closed", http_status: response.status, detail: "Source posting no longer available" };
      return { status: "uncertain", ...(response.status ? { http_status: response.status } : {}), detail: `Source: ${safeReason(new Error(response.error))}` };
    }
    try {
      const actual = ADAPTERS[job.source].postingId(response.body);
      // A 200 HTML error page, wrong identity or incomplete posting is not confirmation.
      ADAPTERS[job.source].normalize(response.body, job.tenant);
      if (actual !== job.source_job_id) throw new Error("Identity mismatch");
      return { status: "open", http_status: 200, detail: "Source confirms posting" };
    } catch { return { status: "uncertain", http_status: response.status, detail: "Source posting validation failed" }; }
  };
  const link = async (applyUrl: string): Promise<Check> => {
    let url = publicLink(applyUrl);
    if (!url) return { status: "uncertain", detail: "Unsafe or invalid apply link" };
    try {
      for (let redirects = 0; ; redirects++) {
        const current = url;
        const response = await limiter.run(current.href, async () => {
          // Queue wait is not network time. Each hop gets its budget after admission.
          const signal = AbortSignal.timeout(15_000);
          metrics.requests++;
          const result = await fetch(current, { method: "GET", redirect: "manual", signal, headers: { "User-Agent": USER_AGENT } });
          await result.body?.cancel();
          return result;
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects >= 5) return { status: "uncertain", http_status: response.status, detail: "Apply link exceeded five redirects" };
          const location = response.headers.get("location");
          if (!location) return { status: "uncertain", http_status: response.status, detail: "Apply redirect has no destination" };
          url = publicLink(new URL(location, current).href);
          if (!url) return { status: "uncertain", detail: "Unsafe apply redirect" };
          if (genericDestination(url)) return { status: "uncertain", http_status: response.status, detail: "Apply redirect points to generic careers or login page" };
          continue;
        }
        if (response.status === 404 || response.status === 410)
          return { status: "link_broken", http_status: response.status, detail: "Apply link no longer available" };
        if (response.ok) return { status: "open", http_status: response.status, detail: "Source and apply link confirmed" };
        return { status: "uncertain", http_status: response.status, detail: `Apply link HTTP ${response.status}` };
      }
    } catch (error) {
      if (dnsNotFound(error)) return { status: "link_broken", detail: "Apply link DNS name not found" };
      return { status: "uncertain", detail: `Apply link: ${safeReason(error)}` };
    }
  };
  return {
    metrics, source, link,
    async check(job: VerifyJob): Promise<VerificationResult> {
      const state = await source(job);
      return state.status === "open"
        ? { id: job.id, stage: "verify_link", ...await link(job.apply_url) }
        : { id: job.id, stage: "verify_source", ...state };
    },
  };
}

export async function runVerification(options: {
  client: { call(body: unknown): Promise<unknown>; metrics: RequestMetrics };
  limit?: number;
  log?: (line: string) => void;
  checker?: ReturnType<typeof verifier>;
}) {
  const limit = z.number().int().min(1).max(500).parse(options.limit ?? 500);
  const log = options.log ?? console.log;
  const started = Date.now();
  let stage: Stage = "verify_queue";
  try {
    const queue = z.object({ run_id: z.uuid(), jobs: z.array(VerifyJobSchema).max(limit) }).parse(
      await options.client.call({ operation: "verify_queue", limit }),
    );
    if (new Set(queue.jobs.map((job) => job.id)).size !== queue.jobs.length)
      throw new CollectorError("Duplicate jobs in verification queue");
    const checker = options.checker ?? verifier({ queuedJobs: queue.jobs });
    stage = "verify_source";
    const results = await Promise.all(queue.jobs.map(async (job) => {
      let result: VerificationResult;
      try { result = await checker.check(job); }
      catch (error) {
        log(errorLine("verify_source", `${job.source}:${job.tenant}`, error, job.id));
        result = { id: job.id, stage: "verify_source", status: "uncertain", detail: safeReason(error) };
      }
      const { stage: checkStage, ...report } = result;
      log(eventLine({ event: "verification_result", stage: checkStage, board: `${job.source}:${job.tenant}`,
        job_id: job.id, status: result.status, detail: result.detail, http_status: result.http_status }));
      return report;
    }));
    stage = "verify_results";
    const totals = { recorded: 0, withdrawn: 0, flagged: 0 };
    for (let i = 0; i < results.length; i += 100) {
      const batch = results.slice(i, i + 100);
      const ack = z.object({ recorded: count, withdrawn: count, flagged: count }).parse(
        await options.client.call({ operation: "verify_results", run_id: queue.run_id, results: batch }),
      );
      if (ack.recorded !== batch.length || ack.withdrawn > ack.recorded || ack.flagged > ack.recorded)
        throw new CollectorError("Verification acknowledgment mismatch");
      totals.recorded += ack.recorded; totals.withdrawn += ack.withdrawn; totals.flagged += ack.flagged;
    }
    const classifications = { open: 0, closed: 0, link_broken: 0, uncertain: 0 };
    for (const result of results) classifications[result.status]++;
    const summary = { run_id: queue.run_id, jobs_checked: results.length, ...totals, classifications,
      requests: checker.metrics.requests + options.client.metrics.requests,
      source_and_link_requests: checker.metrics.requests, collector_requests: options.client.metrics.requests,
      payload_bytes: options.client.metrics.payload_bytes, duration_ms: Date.now() - started };
    log(JSON.stringify({ stage: "complete", board: "run", ...summary }));
    return summary;
  } catch (error) { log(errorLine(stage, "run", error)); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    assertRunnerContext();
    await runVerification({ client: clientFromEnv(), limit: Number(process.env.VERIFY_LIMIT ?? 500) });
  })().catch((error) => { console.error(errorLine("complete", "run", error)); process.exitCode = 1; });
}
