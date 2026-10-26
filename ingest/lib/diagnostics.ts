import { ZodError } from "zod";

export type Stage = "restore" | "checkpoint" | "fetch" | "publish" | "complete";
/** Use only for locally authored messages, never response text or request data. */
export class CollectorError extends Error {}

/** Do not serialize arbitrary errors: fetch/Zod/server errors can contain credentials or bodies. */
export function safeReason(error: unknown): string {
  if (error instanceof CollectorError) return error.message;
  if (error instanceof ZodError)
    return `Validation failed (${[...new Set(error.issues.map((issue) => issue.code))].join(", ")})`;
  const message = error instanceof Error ? error.message : String(error);
  const http = message.match(/\bHTTP ([1-5]\d\d)\b/);
  if (http) return `HTTP ${http[1]}`;
  if (/timeout|timed out|aborted/i.test(message) ||
      (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)))
    return "Request timeout";
  if (/invalid JSON/i.test(message)) return "Invalid JSON response";
  if (/response exceeds \d+ bytes/.test(message)) return "Response size limit exceeded";
  if (/validation|unexpected listing shape|acknowledgment/i.test(message))
    return "Response validation failed";
  return "Unexpected error (details suppressed)";
}

export function errorLine(stage: Stage, board: string, error: unknown): string {
  // Defense in depth: even trusted messages and board labels may coincide with a secret.
  const redact = (value: string) => {
    for (const name of ["COLLECTOR_ENDPOINT", "COLLECTOR_TOKEN", "COLLECTOR_VERCEL_BYPASS"]) {
      const secret = process.env[name];
      if (secret) value = value.split(secret).join("[redacted]");
    }
    return value;
  };
  return JSON.stringify({ stage, board: redact(board), reason: redact(safeReason(error)) });
}
