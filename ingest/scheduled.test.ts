import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acquire: vi.fn(), finish: vi.fn(), restore: vi.fn(), save: vi.fn(), publish: vi.fn() }));
vi.mock("node:fs", () => ({ mkdirSync: vi.fn(), readFileSync: () => JSON.stringify({ targets: [{ source: "ashby", tenant: "example", company: "Example" }] }) }));
vi.mock("./lib/remote-state", () => ({ remoteState: () => ({ acquire: mocks.acquire, finish: mocks.finish, storage: {} }) }));
vi.mock("./lib/runner-cache", () => ({ restoreRunnerCache: () => false, saveRunnerCache: vi.fn() }));
vi.mock("./lib/checkpoint", () => ({ restoreCheckpoint: mocks.restore, saveCheckpoint: mocks.save }));
vi.mock("./lib/remote-writer", () => ({ remoteWriter: () => ({ label: "test" }) }));
vi.mock("./lib/store", () => ({ openStore: () => ({ close: vi.fn(), exec: vi.fn(), prepare: () => ({ get: () => undefined, all: () => [], run: vi.fn() }) }), startRun: () => 1, finishRun: vi.fn() }));
vi.mock("./lib/fetch", () => ({ syncTargets: vi.fn(), fetchAll: async () => ({ failed: 0, errors: 0, listed: 0, changed: 0 }) }));
vi.mock("./lib/gate", () => ({ gateAll: () => ({ counts: {}, reasonCounts: {} }) }));
vi.mock("./lib/publish", () => ({ buildPlan: () => ({ withdraw: [] }), applyPlan: mocks.publish }));
import { runScheduled } from "./scheduled";
import { CollectorError } from "./lib/diagnostics";
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({ GITHUB_REPOSITORY: "varveta/applysmooth-data-fetch", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", COLLECTOR_ENDPOINT: "https://example.test/api", COLLECTOR_TOKEN: "t".repeat(32), COLLECTOR_CACHE_KEY: "key" })) vi.stubEnv(key, value);
  mocks.acquire.mockResolvedValue({ generation: 1, manifest: { chunks: [] } });
  mocks.save.mockResolvedValue({ generation: 2, chunks: [] });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it.each(["acquire", "restore"] as const)("labels %s failures as restore exactly once", async (step) => {
  mocks[step].mockRejectedValueOnce(new CollectorError("Restore failed"));
  await expect(runScheduled()).rejects.toThrow("Restore failed");
  expect(errors).toHaveBeenCalledTimes(1);
  expect(JSON.parse(errors.mock.calls[0][0])).toMatchObject({ stage: "restore", reason: "Restore failed" });
});
it("logs a publish failure once and a distinct lease cleanup failure separately", async () => {
  mocks.publish.mockRejectedValueOnce(new CollectorError("Publish failed"));
  mocks.finish.mockRejectedValueOnce(new CollectorError("Lease finish failed"));
  await expect(runScheduled()).rejects.toThrow("Lease finish failed");
  expect(errors.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])))).toMatchObject([
    { stage: "publish", reason: "Publish failed" }, { stage: "complete", reason: "Lease finish failed" },
  ]);
});
it("labels checkpoint persistence separately from publication", async () => {
  mocks.save.mockRejectedValueOnce(new CollectorError("Checkpoint failed"));
  await expect(runScheduled()).rejects.toThrow("Checkpoint failed");
  expect(errors).toHaveBeenCalledTimes(1);
  expect(JSON.parse(errors.mock.calls[0][0])).toMatchObject({ stage: "checkpoint", reason: "Checkpoint failed" });
});
