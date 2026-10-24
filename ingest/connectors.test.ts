import { it, expect, afterEach, vi } from "vitest";
import { ashby, lever, greenhouse } from "@/lib/jobs-ingest/adapters";
import { evaluateGates } from "@/lib/jobs-ingest/gates";
import { getJson } from "./lib/http";
import {
  greenhouseFixture,
  leverFixture,
  ashbyFixture,
} from "./synthetic-fixtures";
afterEach(() => vi.unstubAllGlobals());
for (const [name, adapter, fixture] of [
  ["greenhouse", greenhouse, greenhouseFixture],
  ["lever", lever, leverFixture],
  ["ashby", ashby, ashbyFixture],
] as const) {
  it(`${name} normalizes a synthetic response and rejects malformed data`, () => {
    const job = adapter.normalize(fixture, "example", "Example");
    expect(job.title).toBe("Data Engineer");
    expect(job.company).toBe("Example");
    expect(job.salary).toBeNull();
    expect(job.visas).toEqual([]);
    const ctx = {
      now: new Date("2026-10-24T12:00:00Z"),
      open: true,
      lastSeenAt: "2026-10-24T12:00:00Z",
      duplicateOf: null,
    };
    expect(evaluateGates({ ...job, usEligibility: "us" }, ctx).status).toBe(
      "accepted",
    );
    expect(
      evaluateGates({ ...job, usEligibility: "unknown" }, ctx).status,
    ).toBe("quarantined");
    expect(
      evaluateGates({ ...job, applyUrl: "http://127.0.0.1" }, ctx).status,
    ).toBe("rejected");
    expect(
      evaluateGates({ ...job, postedAt: "2020-01-01T00:00:00Z" }, ctx).status,
    ).toBe("rejected");
    expect(
      evaluateGates({ ...job, descriptionText: "x".repeat(50001) }, ctx).status,
    ).toBe("rejected");
    expect(() => adapter.normalize({}, "example", "Example")).toThrow();
  });
}
for (const status of [429, 500, 503])
  it(`retries HTTP ${status} within a bound`, async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status }))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", f);
    const result = await getJson("https://example.test", {
      attempts: 2,
      baseDelayMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
for (const status of [404, 410])
  it(`does not retry HTTP ${status}`, async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", f);
    expect((await getJson("https://example.test", { baseDelayMs: 0 })).ok).toBe(
      false,
    );
    expect(f).toHaveBeenCalledTimes(1);
  });
it("bounds network failures, malformed JSON and oversized responses", async () => {
  const f = vi.fn().mockRejectedValue(Error("timeout"));
  vi.stubGlobal("fetch", f);
  expect(
    (await getJson("https://example.test", { attempts: 2, baseDelayMs: 0 })).ok,
  ).toBe(false);
  expect(f).toHaveBeenCalledTimes(2);
  vi.stubGlobal("fetch", async () => new Response("{"));
  expect((await getJson("https://example.test", { attempts: 1 })).ok).toBe(
    false,
  );
  vi.stubGlobal("fetch", async () => new Response("123456"));
  expect(
    (await getJson("https://example.test", { attempts: 1, maxBytes: 2 })).ok,
  ).toBe(false);
});
