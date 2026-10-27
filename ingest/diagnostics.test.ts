import { afterEach, expect, it, vi } from "vitest";
import { errorLine, eventLine, CollectorError, safeReason } from "./lib/diagnostics";
import { remoteState } from "./lib/remote-state";
import { remoteWriter } from "./lib/remote-writer";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("reports new local errors without a copied message allowlist", () => {
  expect(safeReason(new CollectorError("A new local validation failure"))).toBe("A new local validation failure");
  expect(safeReason(new Error("private source body"))).toBe("Unexpected error (details suppressed)");
});

it("redacts verification result fields without giving them an error shape", () => {
  vi.stubEnv("COLLECTOR_TOKEN", "private-token");
  vi.stubEnv("COLLECTOR_ENDPOINT", "https://private.example.test/api");
  vi.stubEnv("COLLECTOR_VERCEL_BYPASS", "private-bypass");
  const line = eventLine({ event: "verification_result", status: "open", job_id: "private-token",
    detail: "private-bypass", board: "https://private.example.test/api" });
  expect(JSON.parse(line)).toEqual({ event: "verification_result", status: "open", job_id: "[redacted]", detail: "[redacted]", board: "[redacted]" });
  expect(JSON.parse(line)).not.toHaveProperty("reason");
});

for (const mode of ["publish", "state"] as const) {
  it(`retains the last HTTP status from legacy ${mode} retries without its body`, async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("PRIVATE_RESPONSE_BODY", { status: 503 })));
    const endpoint = "https://example.test/private";
    const token = "t".repeat(32);
    const pending = (mode === "publish"
      ? remoteWriter(endpoint, token, "test", "lease").publish([])
      : remoteState(endpoint, token, "lease").acquire()).catch((error) => error);
    await vi.runAllTimersAsync();
    const line = errorLine("publish", "ashby:example", await pending);
    expect(JSON.parse(line)).toMatchObject({ stage: "publish", board: "ashby:example", reason: expect.stringContaining("HTTP 503") });
    for (const secret of [endpoint, token, "PRIVATE_RESPONSE_BODY"]) expect(line).not.toContain(secret);
  });
}
