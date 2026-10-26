import { afterEach, describe, expect, it, vi } from "vitest";
import { collectorClient } from "./lib/collector-client";
import { lifecycleOptionsFromEnv, runLifecycle } from "./lifecycle";

const preview = { archived: 12, deleted: 0, tombstoned: 0, delete_enabled: false };
const log = () => {};
function fakeClient(response: unknown = preview) {
  return { call: vi.fn().mockResolvedValue(response), metrics: { requests: 0, payload_bytes: 0 } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("lifecycle gates", () => {
  it("only previews by default and never changes deletion settings", async () => {
    const client = fakeClient();
    const result = await runLifecycle({ client, log });
    expect(client.call.mock.calls).toEqual([[{ operation: "lifecycle_run", dry_run: true }]]);
    expect(result).toMatchObject({ applied: false, preview, actual: null });
  });
  it("applies only after a valid dry run and explicit apply=true", async () => {
    const client = fakeClient();
    const lines: string[] = [];
    const result = await runLifecycle({ client, apply: true, log: (line) => lines.push(line) });
    expect(client.call.mock.calls).toEqual([
      [{ operation: "lifecycle_run", dry_run: true }],
      [{ operation: "lifecycle_run", dry_run: false }, { attempts: 1 }],
    ]);
    expect(result).toMatchObject({ applied: true, preview, actual: preview });
    expect(lines.map((line) => JSON.parse(line).stage)).toEqual(["lifecycle_dry_run", "lifecycle_apply", "complete"]);
  });
  it.each([
    { ...preview, archived: 5001 },
    { ...preview, deleted: 1001, tombstoned: 1001, delete_enabled: true },
  ])("refuses over-limit dry run %j without applying", async (response) => {
    const client = fakeClient(response), lines: string[] = [];
    await expect(runLifecycle({ client, apply: true, log: (line) => lines.push(line) })).rejects.toThrow("exceeds limits");
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(lines.some((line) => line.includes("nothing applied"))).toBe(true);
  });
  it("permits the exact thresholds", async () => {
    const client = fakeClient({ archived: 5000, deleted: 1000, tombstoned: 1000, delete_enabled: true });
    await runLifecycle({ client, apply: true, log });
    expect(client.call).toHaveBeenCalledTimes(2);
  });
  it("supports lower operator limits", async () => {
    const client = fakeClient();
    await expect(runLifecycle({ client, apply: true, archiveLimit: 10, deleteLimit: 0, log })).rejects.toThrow("archive 12/10");
    expect(client.call).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...preview, archived: -1 }, { ...preview, deleted: 0.5 }, { ...preview, deleted: 1 },
    { ...preview, archived: "12" }, { archived: 0, deleted: 0, tombstoned: 0 },
  ])("rejects invalid previews without apply: %j", async (response) => {
    const client = fakeClient(response);
    await expect(runLifecycle({ client, apply: true, log })).rejects.toThrow();
    expect(client.call).toHaveBeenCalledTimes(1);
  });
  it("does not apply if dry run request fails", async () => {
    const client = fakeClient(); client.call.mockRejectedValueOnce(new Error("HTTP 503"));
    await expect(runLifecycle({ client, apply: true, log })).rejects.toThrow();
    expect(client.call).toHaveBeenCalledTimes(1);
  });
  it("parses false literally instead of treating it as truthy", () => {
    expect(lifecycleOptionsFromEnv({})).toEqual({ apply: false, archiveLimit: 5000, deleteLimit: 1000 });
    expect(lifecycleOptionsFromEnv({ LIFECYCLE_APPLY: "false" }).apply).toBe(false);
    expect(lifecycleOptionsFromEnv({ LIFECYCLE_APPLY: "true" }).apply).toBe(true);
    expect(() => lifecycleOptionsFromEnv({ LIFECYCLE_APPLY: "yes" })).toThrow();
    expect(() => lifecycleOptionsFromEnv({ LIFECYCLE_ARCHIVE_LIMIT: "NaN" })).toThrow();
  });
  it("logs safe reasons without endpoint values or credentials", async () => {
    const secret = "secret-token-value", endpoint = "https://collector.example.test/api";
    vi.stubEnv("COLLECTOR_TOKEN", secret); vi.stubEnv("COLLECTOR_ENDPOINT", endpoint);
    const lines: string[] = [], client = fakeClient();
    client.call.mockRejectedValueOnce(new Error(`HTTP 503 ${secret} ${endpoint}`));
    await expect(runLifecycle({ client, log: (line) => lines.push(line) })).rejects.toThrow();
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ stage: "lifecycle_dry_run", board: "run", reason: "HTTP 503" }]);
  });
  it("never retries an ambiguous apply response", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(preview)))
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    vi.stubGlobal("fetch", fetch);
    const client = collectorClient({ endpoint: "https://collector.example.test/api", token: "t".repeat(32), baseDelayMs: 0 });
    await expect(runLifecycle({ client, apply: true, log })).rejects.toThrow("Request timeout");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).dry_run)).toEqual([true, false]);
  });
});
