import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostLimiter, pool } from "./lib/http";
import { runVerification, verifier, type VerifyJob } from "./verify";
import { ashbyFixture, greenhouseFixture, leverFixture } from "./synthetic-fixtures";

const fixtures = { greenhouse: greenhouseFixture, lever: leverFixture, ashby: ashbyFixture };
const runId = "c2f5c7ab-11e6-4b70-b803-f76bd7d98df5";
const job = (source: VerifyJob["source"] = "greenhouse", id = "catalog-1"): VerifyJob => ({
  id, source, tenant: "example", source_job_id: String(fixtures[source].id),
  apply_url: `https://careers.example.com/postings/${id}`, reason: "uncertain",
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let mockFetch: ReturnType<typeof vi.fn>;
beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(["greenhouse", "lever", "ashby"] as const)("%s verification", (source) => {
  const success = () => source === "ashby" ? { jobs: [fixtures[source]] } : fixtures[source];
  it("reports open only after both source and apply link succeed", async () => {
    mockFetch.mockResolvedValueOnce(json(success())).mockResolvedValueOnce(new Response("Apply"));
    expect(await verifier().check(job(source))).toMatchObject({ status: "open", http_status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it("reports closed from definitive source evidence without checking the link", async () => {
    mockFetch.mockResolvedValueOnce(source === "ashby" ? json({ jobs: [{ ...ashbyFixture, id: "another-posting" }] }) : json({}, 404));
    expect(await verifier().check(job(source))).toMatchObject({ status: "closed" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 503])("keeps HTTP %s uncertain", async (status) => {
    mockFetch.mockResolvedValueOnce(json({}, status));
    expect(await verifier().check(job(source))).toMatchObject({ status: "uncertain", http_status: status });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("keeps timeouts uncertain", async () => {
    mockFetch.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect(await verifier().check(job(source))).toMatchObject({ status: "uncertain" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("keeps invalid JSON and malformed successful responses uncertain", async () => {
    mockFetch.mockResolvedValueOnce(new Response("<html>error</html>"));
    expect((await verifier().check(job(source))).status).toBe("uncertain");
    mockFetch.mockResolvedValueOnce(json(source === "ashby" ? { jobs: [{}] } : {}));
    expect((await verifier().check(job(source))).status).toBe("uncertain");
  });
});

describe("source-specific evidence", () => {
  it("holds every queued job uncertain when the Ashby board is empty", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => ({ ...job("ashby", String(i)), source_job_id: String(i) }));
    mockFetch.mockResolvedValue(json({ jobs: [] }));
    const checker = verifier({ queuedJobs: jobs });
    const results = await Promise.all(jobs.map((job) => checker.check(job)));
    expect(results.map((result) => result.status)).toEqual(Array(5).fill("uncertain"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("holds a board whose size falls below half its distinct queued postings", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => ({ ...job("ashby", String(i)), source_job_id: String(i) }));
    mockFetch.mockResolvedValue(json({ jobs: [{ ...ashbyFixture, id: "0" }, { ...ashbyFixture, id: "1" }] }));
    const checker = verifier({ queuedJobs: jobs });
    expect((await Promise.all(jobs.map((job) => checker.check(job)))).every((result) => result.status === "uncertain")).toBe(true);
  });
  it("fetches each Ashby tenant once, sharing even concurrent requests", async () => {
    mockFetch.mockImplementation(async (url) => String(url).includes("posting-api")
      ? json({ jobs: [ashbyFixture] }) : new Response("Apply"));
    const checker = verifier();
    const results = await Promise.all([
      checker.check(job("ashby", "1")), checker.check(job("ashby", "2")),
      checker.check({ ...job("ashby", "3"), source_job_id: "missing" }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["open", "open", "closed"]);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("posting-api"))).toHaveLength(1);
  });
  it("never closes Ashby postings because the board endpoint returned 404", async () => {
    mockFetch.mockResolvedValue(json({}, 404));
    const checker = verifier();
    const results = await Promise.all([checker.check(job("ashby")), checker.check(job("ashby", "2"))]);
    expect(results.every((result) => result.status === "uncertain")).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each(["greenhouse", "lever"] as const)("rejects a wrong identity from %s", async (source) => {
    mockFetch.mockResolvedValueOnce(json({ ...fixtures[source], id: "wrong" }));
    expect((await verifier().check(job(source))).status).toBe("uncertain");
  });
  it.each(["greenhouse", "lever"] as const)("treats %s HTTP 410 as closed", async (source) => {
    mockFetch.mockResolvedValueOnce(json({}, 410));
    expect((await verifier().check(job(source))).status).toBe("closed");
  });
});

describe("apply links", () => {
  it.each([[200, "open"], [404, "link_broken"], [410, "link_broken"], [403, "uncertain"], [429, "uncertain"], [503, "uncertain"]] as const)("classifies HTTP %s as %s", async (httpStatus, status) => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: httpStatus }));
    expect(await verifier().link(job().apply_url)).toMatchObject({ status, http_status: httpStatus });
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("recognizes definitive DNS failure through fetch's nested cause", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed", { cause: Object.assign(new Error("DNS"), { code: "ENOTFOUND" }) }));
    expect(await verifier().link(job().apply_url)).toMatchObject({ status: "link_broken", detail: "Apply link DNS name not found" });
  });
  it.each(["timeout", "temporary-dns", "tls"])("keeps %s uncertain", async (reason) => {
    const error = reason === "timeout" ? new DOMException("timeout", "TimeoutError")
      : new TypeError("fetch failed", { cause: Object.assign(new Error("private hostname"), { code: reason === "temporary-dns" ? "EAI_AGAIN" : "CERT_HAS_EXPIRED" }) });
    mockFetch.mockRejectedValueOnce(error);
    expect((await verifier().link(job().apply_url)).status).toBe("uncertain");
  });
  it.each(["https://careers.example.com/", "https://www.example.com/careers", "https://www.example.com/en-US/jobs", "https://jobs.ashbyhq.com/example", "https://jobs.lever.co/example", "https://job-boards.greenhouse.io/acme?error=true"])("keeps redirect to generic root %s uncertain", async (location) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
    expect((await verifier().link(job().apply_url)).status).toBe("uncertain");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("follows a job-specific redirect and cancels bodies", async () => {
    const cancel = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://apply.example.org/job/123" } }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    expect((await verifier().link(job().apply_url)).status).toBe("open");
    expect(cancel).toHaveBeenCalledOnce();
    expect(String(mockFetch.mock.calls[1][0])).toBe("https://apply.example.org/job/123");
  });
  it("allows a job query parameter on a board root", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://example.com/careers?gh_jid=123" } }))
      .mockResolvedValueOnce(new Response("Apply"));
    expect((await verifier().link(job().apply_url)).status).toBe("open");
  });
  it("follows no more than five redirects", async () => {
    mockFetch.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/postings/loop" } }));
    expect((await verifier().link(job().apply_url)).detail).toContain("five redirects");
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });
  it.each(["https://127.0.0.1/job/1", "http://example.com/job/1", "https://user:password@example.com/job/1", "https://example.com:8080/job/1"])("does not request unsafe redirect %s", async (location) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
    expect((await verifier().link(job().apply_url)).status).toBe("uncertain");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("request pacing and endpoint reporting", () => {
  it("gives 100 healthy links a full network timeout after a long host queue wait", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
      return controller.signal;
    });
    mockFetch.mockImplementation(async (_url, init) => {
      init.signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      init.signal.throwIfAborted();
      return new Response("Apply");
    });
    const checker = verifier();
    const pending = Promise.all(Array.from({ length: 100 }, (_, i) => checker.link(`https://jobs.ashbyhq.com/example/${i}`)));
    await vi.runAllTimersAsync();
    expect((await pending).every((result) => result.status === "open")).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(100);
  });
  it("reports an invalid apply link as a verification result with the correct stage", async () => {
    mockFetch.mockResolvedValueOnce(json(greenhouseFixture));
    const lines: string[] = [];
    const client = { metrics: { requests: 0, payload_bytes: 0 }, call: async (body: any) => body.operation === "verify_queue"
      ? { run_id: runId, jobs: [{ ...job(), apply_url: "invalid" }] } : { recorded: 1, withdrawn: 0, flagged: 0 } };
    await runVerification({ client, log: (line) => lines.push(line) });
    expect(JSON.parse(lines[0])).toMatchObject({ event: "verification_result", stage: "verify_link", status: "uncertain" });
    expect(JSON.parse(lines[0])).not.toHaveProperty("reason");
  });
  it("enforces per-host limits when many jobs redirect onto the same host", async () => {
    const active = new Map<string, number>(), peak = new Map<string, number>();
    mockFetch.mockImplementation(async (value) => {
      const url = new URL(String(value)), host = url.hostname;
      active.set(host, (active.get(host) ?? 0) + 1);
      peak.set(host, Math.max(peak.get(host) ?? 0, active.get(host)!));
      await new Promise((resolve) => setTimeout(resolve, 2));
      active.set(host, active.get(host)! - 1);
      if (host === "boards-api.greenhouse.io") return json({ ...greenhouseFixture, id: url.pathname.split("/").at(-1) });
      if (host !== "shared.example.org") return new Response(null, { status: 302, headers: { location: `https://shared.example.org${url.pathname}` } });
      return new Response("Apply");
    });
    const checker = verifier({ perHost: 2, concurrency: 5 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => checker.check({ ...job("greenhouse", String(i)), source_job_id: String(i), apply_url: `https://host${i}.example.com/postings/${i}` })));
    expect(results.every((result) => result.status === "open")).toBe(true);
    expect(peak.get("shared.example.org")).toBe(2);
    expect(peak.get("boards-api.greenhouse.io")).toBe(2);
    expect([...peak.values()].every((value) => value <= 2)).toBe(true);
    expect(checker.metrics.requests).toBe(36);
  });
  it("releases limiter slots after failure and respects the global limit", async () => {
    const limiter = hostLimiter(2, 1);
    let active = 0, peak = 0;
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => limiter.run(`https://host${i % 3}.example.com`, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (i === 0) throw new Error("failure");
    })));
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(peak).toBe(2);
  });
  it("reports in batches, sends classifications only and counts requests", async () => {
    const jobs = Array.from({ length: 205 }, (_, i) => ({ ...job("ashby", String(i)), source_job_id: "missing" }));
    mockFetch.mockResolvedValue(json({ jobs: [ashbyFixture] }));
    const requests: any[] = [], logs: string[] = [];
    const client = { metrics: { requests: 0, payload_bytes: 0 }, call: async (body: any) => {
      requests.push(body); client.metrics.requests++;
      client.metrics.payload_bytes += Buffer.byteLength(JSON.stringify(body));
      return body.operation === "verify_queue" ? { run_id: runId, jobs } : { recorded: body.results.length, withdrawn: body.results.length, flagged: 0 };
    } };
    const result = await runVerification({ client, log: (line) => logs.push(line) });
    expect(requests.map((body) => body.operation)).toEqual(["verify_queue", "verify_results", "verify_results", "verify_results"]);
    expect(requests.slice(1).map((body) => body.results.length)).toEqual([100, 100, 5]);
    expect(result).toMatchObject({ jobs_checked: 205, requests: 5, classifications: { closed: 205 }, recorded: 205 });
    expect(Object.keys(requests[1].results[0]).sort()).toEqual(["detail", "http_status", "id", "status"]);
    expect(JSON.parse(logs[0])).toMatchObject({ stage: "verify_source", job_id: "0", board: "ashby:example" });
  });
  it("uses the same limits and failure recovery for static board pools", async () => {
    const active = new Map<string, number>();
    let running = 0, peak = 0, finished = 0;
    const failures = await pool(Array.from({ length: 8 }, (_, i) => i), (i) => String(i % 3), 2, 1, async (i) => {
      const key = String(i % 3);
      active.set(key, (active.get(key) ?? 0) + 1);
      expect(active.get(key)).toBe(1);
      running++; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active.set(key, active.get(key)! - 1); running--; finished++;
      if (i === 0) throw new Error("failure");
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].item).toBe(0);
    expect(finished).toBe(8);
    expect(peak).toBe(2);
  });
  it("rejects an oversized queue before source requests", async () => {
    const client = { metrics: { requests: 0, payload_bytes: 0 }, call: async () => ({ run_id: runId, jobs: [job(), job("lever", "2")] }) };
    await expect(runVerification({ client, limit: 1, log: () => {} })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("fails a partial results acknowledgment", async () => {
    mockFetch.mockResolvedValue(json({}, 404));
    const client = { metrics: { requests: 0, payload_bytes: 0 }, call: async (body: any) => body.operation === "verify_queue"
      ? { run_id: runId, jobs: [job()] } : { recorded: 0, withdrawn: 0, flagged: 0 } };
    await expect(runVerification({ client, log: () => {} })).rejects.toThrow("acknowledgment mismatch");
  });
});
