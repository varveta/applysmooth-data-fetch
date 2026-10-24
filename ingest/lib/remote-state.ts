import type { CheckpointStorage, Manifest } from "./checkpoint";
export function remoteState(endpoint: string, token: string, lease: string) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Invalid state endpoint");
  const call = async <T>(body: object): Promise<T> => {
    for (let n = 0; n < 4; n++) {
      let response: Response | undefined;
      try {
        response = await fetch(url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(process.env.COLLECTOR_VERCEL_BYPASS
              ? {
                  "x-vercel-protection-bypass":
                    process.env.COLLECTOR_VERCEL_BYPASS,
                }
              : {}),
          },
          body: JSON.stringify({ ...body, lease }),
        });
      } catch {
        if (n === 3) throw Error("State unavailable");
      }
      if (response?.ok) return (await response.json()) as T;
      if (response) {
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500)
          throw Error(`State HTTP ${response.status}`);
      }
      if (n < 3) await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
    }
    throw Error("State unavailable");
  };
  const signed = (raw: string) => {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "qhilcyvwvesqfuykdows.supabase.co"
    )
      throw Error("Unexpected storage destination");
    return u;
  };
  const storage: CheckpointStorage = {
    get: async (key) => {
      const { url } = await call<{ url: string }>({
        operation: "download",
        key,
      });
      const response = await fetch(signed(url), {
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw Error("Checkpoint download failed");
      const reader = response.body!.getReader();
      let size = 0;
      const chunks = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16_000_000) throw Error("Checkpoint chunk too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    },
    put: async (key, bytes) => {
      const info = await call<{ exists: boolean; bytes: number }>({
        operation: "info",
        key,
      });
      if (info.exists) {
        if (info.bytes !== bytes.length)
          throw Error("Checkpoint size conflict");
        return;
      }
      const { url } = await call<{ url: string }>({ operation: "upload", key });
      const response = await fetch(signed(url), {
        method: "PUT",
        body: Buffer.from(bytes),
        headers: { "Content-Type": "application/octet-stream" },
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      await response.body?.cancel();
      if (!response.ok) throw Error("Checkpoint upload failed");
    },
    commit: async (expectedGeneration, manifest) => {
      await call({ operation: "commit", expectedGeneration, manifest });
    },
  };
  return {
    storage,
    acquire: () =>
      call<{ manifest: Manifest; generation: number }>({
        operation: "acquire",
      }),
    finish: (fetchSuccess: boolean, publishSuccess: boolean, failed: boolean) =>
      call({ operation: "finish", fetchSuccess, publishSuccess, failed }),
  };
}
