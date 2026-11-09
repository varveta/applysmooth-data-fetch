import { afterEach, expect, it, vi } from "vitest";
import { collectorClient } from "./lib/collector-client";

afterEach(() => vi.unstubAllGlobals());
const body = { operation: "publish_batch", batch_no: 3, rows: [{ id: "synthetic" }] };
const client = () => collectorClient({ endpoint: "https://collector.example.test/api/jobs-collector", token: "x".repeat(64), baseDelayMs: 0 });

it.each([400, 401, 409, 413, 422, 500, 502, 501, 504])("does not retry a generic HTTP %s", async (status) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "publish_failed" }), { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(client().call(body)).rejects.toThrow(`HTTP ${status}`);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([408, 429, 503, 504])("retries transient HTTP %s with byte-identical payloads", async (status) => {
  const fetch = vi.fn().mockImplementationOnce(async () => new Response(JSON.stringify({ error: "database_timeout" }), { status }))
    .mockImplementationOnce(async () => Response.json({ accepted: 1 }));
  vi.stubGlobal("fetch", fetch);
  const remote = client();
  await expect(remote.call(body)).resolves.toEqual({ accepted: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  expect(remote.metrics.payload_bytes).toBe(2 * Buffer.byteLength(JSON.stringify(body)));
});

it.each([new TypeError("fetch failed"), new DOMException("timed out", "TimeoutError")])("retries a transport failure with identical bytes", async (error) => {
  const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(Response.json({ accepted: 1 }));
  vi.stubGlobal("fetch", fetch);
  await expect(client().call(body)).resolves.toEqual({ accepted: 1 });
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});

it("does not retry malformed gateway timeout responses", async () => {
  const fetch = vi.fn(async () => new Response("<html>gateway timeout</html>", { status: 504 }));
  vi.stubGlobal("fetch", fetch);
  await expect(client().call(body)).rejects.toThrow("HTTP 504");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not retry an unexpected programming error", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("unexpected internal failure"));
  vi.stubGlobal("fetch", fetch);
  await expect(client().call(body)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});


it("does not count a locally rejected oversized payload as a request or a retry", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const remote = client();
  await expect(remote.call({ data: "x".repeat(900_001) })).rejects.toThrow("Collector batch too large");
  expect(remote.metrics.calls).toBe(0); expect(remote.metrics.requests).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
