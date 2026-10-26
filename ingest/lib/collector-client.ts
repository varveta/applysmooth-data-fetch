import { CollectorError, safeReason } from "./diagnostics";

export const MAX_BATCH_BYTES = 900_000;
export type RequestMetrics = { requests: number; payload_bytes: number };

/** Serialize once; every retry sends exactly the same bytes and identity. */
export function collectorClient(config: {
  endpoint: string;
  token: string;
  bypass?: string;
  baseDelayMs?: number;
  timeoutMs?: number;
}) {
  let url: URL;
  try { url = new URL(config.endpoint); }
  catch { throw new CollectorError("Invalid collector endpoint"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new CollectorError("Invalid collector endpoint");
  if (config.token.length < 32) throw new CollectorError("Missing collector credential");
  const metrics: RequestMetrics = { requests: 0, payload_bytes: 0 };
  return {
    metrics,
    async call(body: unknown): Promise<unknown> {
      const json = JSON.stringify(body);
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > MAX_BATCH_BYTES) throw new CollectorError("Collector batch too large");
      let reason = "Collector unavailable";
      for (let attempt = 0; attempt < 4; attempt++) {
        let wait = (config.baseDelayMs ?? 1000) * 2 ** attempt;
        try {
          metrics.requests++;
          metrics.payload_bytes += bytes;
          const response = await fetch(url, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.token}`,
              ...(config.bypass ? { "x-vercel-protection-bypass": config.bypass } : {}),
            },
            body: json,
          });
          if (response.ok) {
            try { return await response.json(); }
            catch (error) {
              if (error instanceof SyntaxError) throw new CollectorError("Invalid collector JSON response");
              throw error; // Body-read timeout/network failure must retry the same bytes too.
            }
          }
          await response.body?.cancel();
          reason = `HTTP ${response.status}`;
          // In particular, complete_board 409 is terminal: never blindly retry it.
          if (response.status !== 408 && response.status !== 429 && response.status < 500)
            throw new CollectorError(reason);
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter) {
            const seconds = Number(retryAfter);
            const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
            if (ms > 0) wait = Math.min(ms, 60_000);
          }
        } catch (error) {
          if (error instanceof CollectorError) throw error;
          reason = safeReason(error);
        }
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      throw new CollectorError(`Collector retries exhausted: ${reason}`);
    },
  };
}

export function assertRunnerContext(env: NodeJS.ProcessEnv = process.env) {
  if (env.GITHUB_REPOSITORY !== "varveta/applysmooth-data-fetch" ||
      env.GITHUB_REF !== "refs/heads/main" ||
      !["workflow_dispatch", "schedule"].includes(env.GITHUB_EVENT_NAME ?? ""))
    throw new CollectorError("Untrusted runner context");
}

export function clientFromEnv() {
  const endpoint = process.env.COLLECTOR_ENDPOINT;
  const token = process.env.COLLECTOR_TOKEN;
  if (!endpoint || !token) throw new CollectorError("Missing configuration");
  return collectorClient({ endpoint, token, bypass: process.env.COLLECTOR_VERCEL_BYPASS });
}
