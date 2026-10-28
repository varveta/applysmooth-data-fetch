import { describe, expect, it, vi } from "vitest";
import { createJobicyVerifier } from "./lib/verify-feeds";
import type { FetchResult } from "./lib/http";

type Status = "active" | "closed" | "unknown";
const queued = (...ids: string[]) => ids.map((source_job_id) => ({ source: "jobicy", source_job_id }));
const response = (jobs: { id: number; status: Status }[], extra = {}): FetchResult => ({
  ok: true, status: 200, attempts: 1, bytes: 100,
  body: { success: true, statusCode: 200, checkedAt: "2026-10-28T04:00:00Z", count: jobs.length, jobs, ...extra },
});

describe("Jobicy dedicated status verification", () => {
  it("uses one shared request for active, closed and unknown queued jobs", async () => {
    const read = vi.fn(async (_url: string) => response([{ id: 1, status: "active" }, { id: 2, status: "closed" }, { id: 3, status: "unknown" }]));
    const verify = createJobicyVerifier(queued("1", "2", "3"), read);
    const results = await Promise.all([verify("1"), verify("2"), verify("3"), verify("2")]);
    expect(results.map((result) => result.status)).toEqual(["open", "closed", "uncertain", "closed"]);
    expect(read).toHaveBeenCalledTimes(1);
    const url = new URL(read.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://jobicy.com/api/jobs/status");
    expect(url.searchParams.get("ids")).toBe("1,2,3");
    expect(results[1].detail).toContain("explicitly confirms");
  });
  it("batches at 100 IDs and deduplicates queued IDs", async () => {
    const read = vi.fn(async (url: string) => response(new URL(url).searchParams.get("ids")!.split(",").map((id) => ({ id: Number(id), status: "active" }))));
    const ids = Array.from({ length: 201 }, (_, index) => String(index + 1));
    const verify = createJobicyVerifier([...queued(...ids, "1", "2"), { source: "ashby", source_job_id: "999" }], read);
    const results = await Promise.all(ids.map(verify));
    expect(results.every((result) => result.status === "open")).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.map(([url]) => new URL(url).searchParams.get("ids")!.split(",").length)).toEqual([100, 100, 1]);
  });
  it("can confirm jobs older than seven days without requesting a discovery feed", async () => {
    const read = vi.fn(async (_url: string) => response([{ id: 123, status: "active" }]));
    const verify = createJobicyVerifier(queued("123"), read);
    expect((await verify("123")).status).toBe("open");
    expect(new URL(read.mock.calls[0][0]).pathname).toBe("/api/jobs/status");
    expect(new URL(read.mock.calls[0][0]).searchParams.has("cursor")).toBe(false);
  });
  it("shares a lazy single-ID request when no queue was supplied", async () => {
    const read = vi.fn(async () => response([{ id: 50, status: "closed" }]));
    const verify = createJobicyVerifier([], read);
    expect((await Promise.all([verify("50"), verify("50")])).map((result) => result.status)).toEqual(["closed", "closed"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(["", "0", "-1", "1.2", "01", " 1", "1,2", "https://attacker.example", "9007199254740992"])
    ("rejects unsafe or noncanonical posting ID %j without HTTP", async (id) => {
      const read = vi.fn();
      const verify = createJobicyVerifier(queued(id), read);
      expect((await verify(id)).status).toBe("uncertain");
      expect(read).not.toHaveBeenCalled();
    });
  it("rejects a missing requested ID before using another returned closed status", async () => {
    const read = vi.fn(async () => response([{ id: 1, status: "closed" }]));
    const verify = createJobicyVerifier(queued("1", "2"), read);
    expect((await Promise.all([verify("1"), verify("2")])).every((result) => result.status === "uncertain")).toBe(true);
  });
  it.each([
    [{ id: 1, status: "closed" }, { id: 1, status: "closed" }],
    [{ id: 1, status: "closed" }, { id: 3, status: "active" }],
  ] satisfies Array<Array<{ id: number; status: Status }>>)("rejects duplicate and wrong response identities %#", async (...jobs) => {
    const read = vi.fn(async () => response(jobs));
    const verify = createJobicyVerifier(queued("1", "2"), read);
    expect((await verify("1")).status).toBe("uncertain");
  });
  it.each([
    { count: 2 }, { success: false }, { statusCode: 500 }, { checkedAt: "invalid" },
    { jobs: [{ id: 1, status: "expired" }] }, { jobs: [{ id: "1", status: "closed" }] },
  ])("does not interpret malformed status data as closure %#", async (extra) => {
    const read = vi.fn(async () => response([{ id: 1, status: "closed" }], extra));
    expect((await createJobicyVerifier(queued("1"), read)("1")).status).toBe("uncertain");
  });
  it.each([404, 410, 429, 500])("does not convert endpoint HTTP %i into a vacancy closure", async (status) => {
    const read = vi.fn(async (): Promise<FetchResult> => ({ ok: false, status, error: `HTTP ${status}`, attempts: 1, retryable: false }));
    const result = await createJobicyVerifier(queued("1"), read)("1");
    expect(result).toMatchObject({ status: "uncertain", http_status: status });
  });
  it("holds closures on thrown transport errors and malformed HTTP 200 bodies", async () => {
    const thrown = vi.fn(async (): Promise<FetchResult> => { throw new Error("timeout"); });
    expect((await createJobicyVerifier(queued("1"), thrown)("1")).status).toBe("uncertain");
    const html = vi.fn(async (): Promise<FetchResult> => ({ ok: true, status: 200, attempts: 1, bytes: 15, body: "<html>Error</html>" }));
    expect((await createJobicyVerifier(queued("1"), html)("1")).status).toBe("uncertain");
  });
});
