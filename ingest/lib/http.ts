export const USER_AGENT =
  process.env.JOBS_INGEST_USER_AGENT ??
  "ApplySmoothJobsBot/0.1 (+https://applysmooth.com; support@applysmooth.com)";

export type FetchResult =
  | { ok: true; status: number; body: unknown; bytes: number; attempts: number }
  | {
      ok: false;
      status: number | null;
      error: string;
      attempts: number;
      retryable: boolean;
    };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shared limits for board fetches and verification requests. */
export const HTTP_CONCURRENCY = 8;
export const HTTP_PER_HOST = 4;

/** One scheduler for static pools and dynamic HTTP work. */
function keyedLimiter(limit: number, perHost: number) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(perHost) || perHost < 1)
    throw new Error("Concurrency limits must be positive integers");
  const active = new Map<string, number>();
  const queue: { host: string; start(): void }[] = [];
  let running = 0;
  const drain = () => {
    for (let i = 0; i < queue.length && running < limit;) {
      const task = queue[i];
      if ((active.get(task.host) ?? 0) >= perHost) { i++; continue; }
      queue.splice(i, 1);
      running++;
      active.set(task.host, (active.get(task.host) ?? 0) + 1);
      task.start();
    }
  };
  return {
    run<T>(host: string, operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({ host, start: () => {
          Promise.resolve().then(operation).then(resolve, reject).finally(() => {
            running--;
            active.set(host, (active.get(host) ?? 1) - 1);
            drain();
          });
        } });
        drain();
      });
    },
  };
}

/** Hold a host slot until the operation consumes/cancels its body. */
export function hostLimiter(limit = HTTP_CONCURRENCY, perHost = HTTP_PER_HOST) {
  const limiter = keyedLimiter(limit, perHost);
  return {
    run<T>(url: string, operation: () => Promise<T>) {
      return limiter.run(new URL(url).hostname, operation);
    },
  };
}

/**
 * GET JSON with timeout, size cap and bounded retries (network errors, 408, 429, 5xx).
 * 404/410 and other 4xx are terminal. Honors Retry-After up to 60s.
 */
export async function getJson(
  url: string,
  opts: {
    attempts?: number;
    timeoutMs?: number;
    maxBytes?: number;
    baseDelayMs?: number;
  } = {},
): Promise<FetchResult> {
  const attempts = opts.attempts ?? 4;
  const maxBytes = opts.maxBytes ?? 80_000_000;
  let last: FetchResult = {
    ok: false,
    status: null,
    error: "not attempted",
    attempts: 0,
    retryable: true,
  };
  for (let i = 1; i <= attempts; i++) {
    let wait =
      (opts.baseDelayMs ??
        Number(process.env.JOBS_INGEST_RETRY_BASE_MS ?? 1000)) *
      3 ** (i - 1) *
      (0.75 + Math.random() / 2);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        redirect: "follow",
      });
      if (!res.ok) {
        const retryable =
          res.status === 408 || res.status === 429 || res.status >= 500;
        last = {
          ok: false,
          status: res.status,
          error: `HTTP ${res.status}`,
          attempts: i,
          retryable,
        };
        await res.body?.cancel();
        if (!retryable) return last;
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) wait = Math.min(ra * 1000, 60_000);
      } else {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("empty body");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            return {
              ok: false,
              status: res.status,
              error: `response exceeds ${maxBytes} bytes`,
              attempts: i,
              retryable: false,
            };
          }
          chunks.push(value);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          return {
            ok: true,
            status: res.status,
            body: JSON.parse(text),
            bytes: size,
            attempts: i,
          };
        } catch {
          // Truncated/garbled JSON is treated as a failed (incomplete) snapshot.
          last = {
            ok: false,
            status: res.status,
            error: "invalid JSON",
            attempts: i,
            retryable: true,
          };
        }
      }
    } catch (e) {
      last = {
        ok: false,
        status: null,
        error: e instanceof Error ? e.message : String(e),
        attempts: i,
        retryable: true,
      };
    }
    if (i < attempts) await sleep(wait);
  }
  return last;
}

/**
 * Run tasks with a global concurrency limit and a per-key (host) limit.
 * Returns every task that threw, so callers can fail the run instead of losing errors.
 */
export async function pool<T>(
  items: T[],
  key: (t: T) => string,
  limit: number,
  perKey: number,
  run: (t: T) => Promise<void>,
): Promise<{ item: T; error: unknown }[]> {
  const limiter = keyedLimiter(limit, perKey);
  const results = await Promise.allSettled(items.map((item) => limiter.run(key(item), () => run(item))));
  return results.flatMap((result, i) => result.status === "rejected" ? [{ item: items[i], error: result.reason }] : []);
}
