import type { CatalogWriter } from "./publish";
/** Narrow HTTP credential. Never a Supabase key. No table reads or arbitrary RPCs. */
export function remoteWriter(
  endpoint: string,
  token: string,
  label: string,
  lease: string,
): CatalogWriter {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid collector endpoint");
  if (token.length < 32) throw new Error("Missing collector credential");
  const call = async <T>(body: unknown): Promise<T> => {
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json) > 1_000_000)
      throw new Error("Collector batch too large");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          headers: {
            "Content-Type": "application/json",
            ...(process.env.COLLECTOR_VERCEL_BYPASS
              ? {
                  "x-vercel-protection-bypass":
                    process.env.COLLECTOR_VERCEL_BYPASS,
                }
              : {}),
            Authorization: `Bearer ${token}`,
          },
          body: json,
        });
        if (response.ok) return (await response.json()) as T;
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500)
          throw new Error(`Terminal collector HTTP ${response.status}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Terminal"))
          throw error;
      }
      if (attempt < 3)
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    throw new Error("Collector unavailable; retry identical batch");
  };
  const unsupported = async (): Promise<never> => {
    throw new Error("Operation not exposed by collector endpoint");
  };
  return {
    label,
    publish: (rows) => call({ operation: "publish", lease, rows }),
    withdraw: (items) => call({ operation: "withdraw", lease, items }),
    lifecycle: unsupported,
    readState: unsupported,
    readPublic: unsupported,
    close: async () => {},
  };
}
