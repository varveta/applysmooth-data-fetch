import { afterEach, expect, it, vi } from "vitest";
import { errorLine } from "./lib/diagnostics";
import { remoteState } from "./lib/remote-state";
import { remoteWriter } from "./lib/remote-writer";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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
