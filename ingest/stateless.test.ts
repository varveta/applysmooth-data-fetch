import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { toCatalogRow } from "@/lib/jobs-ingest/catalog";
import { assertRunnerContext, collectorClient, MAX_BATCH_BYTES } from "./lib/collector-client";
import { CollectorError, errorLine } from "./lib/diagnostics";
import { prepareBoard, runStateless, splitBatches, type StatelessTarget } from "./stateless";
import { ashbyFixture, greenhouseFixture, leverFixture } from "./synthetic-fixtures";

const endpoint = "https://collector.example.test/private-endpoint";
const token = "private-test-token-".repeat(3);
const bypass = "private-test-bypass";
const now = new Date("2026-10-26T12:00:00Z");
const runId = "c2f5c7ab-11e6-4b70-b803-f76bd7d98df5";
const target: StatelessTarget = { source: "greenhouse", tenant: "example", company: "Example" };
const complete = { complete: true, missing: 0, withdrawn: 0, marked_uncertain: 0, guard: "none" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Payload = Record<string, any>;
let bodies: string[];
let logs: string[];
let listings: unknown;
let identityResponse: unknown;
let endpointHandler: ((body: Payload, call: number) => Response | Promise<Response>) | undefined;
let sourceHandler: (() => Response | Promise<Response>) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function client() { return collectorClient({ endpoint, token, bypass, baseDelayMs: 0 }); }
function run(targets = [target], remote = client()) {
  return runStateless({ targets, client: remote, runId, now, log: (line) => logs.push(line) });
}
const operations = () => bodies.map((body) => JSON.parse(body).operation);
const manyJobs = (count: number) => Array.from({ length: count }, (_, i) => ({
  ...greenhouseFixture, id: i + 1, internal_job_id: i + 1, title: `Data Engineer ${i}`,
  content: "SQL Python 数据工程 ".repeat(3000),
}));

beforeEach(() => {
  bodies = []; logs = []; listings = { jobs: [greenhouseFixture] };
  identityResponse = undefined;
  endpointHandler = undefined; sourceHandler = undefined;
  vi.stubEnv("JOBS_INGEST_RETRY_BASE_MS", "0");
  vi.stubEnv("COLLECTOR_ENDPOINT", endpoint);
  vi.stubEnv("COLLECTOR_TOKEN", token);
  vi.stubEnv("COLLECTOR_VERCEL_BYPASS", bypass);
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== endpoint) return sourceHandler ? sourceHandler() : json(listings);
    const body = JSON.parse(String(init?.body));
    if (body.operation === "board_identities") return json(identityResponse ?? { source: body.source, tenant: body.tenant, complete: true, identities: [] });
    bodies.push(String(init?.body));
    if (endpointHandler) return endpointHandler(body, bodies.length);
    if (body.operation === "publish_batch") return json({
      accepted: body.rows.length,
      results: body.rows.map((row: Payload) => ({ id: row.id, outcome: "inserted" })),
    });
    return json(body.operation === "board_fetch_failed" ? { recorded: true } : complete);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("stateless board processing", () => {
  it("stops before any publication when backend identity history is unavailable", async () => {
    identityResponse = { complete: false, identities: [] };
    await expect(run()).rejects.toThrow("1 board(s) failed");
    expect(operations()).toEqual([]);
  });

  it("preserves the original ID and date when a lower-ID sibling appears, then the original disappears", () => {
    const original = { ...greenhouseFixture, id: 5 };
    const sibling = { ...greenhouseFixture, id: 3 };
    const empty = { source: target.source, tenant: target.tenant, complete: true, identities: [] };
    const first = prepareBoard(target, { jobs: [original] }, now, empty).rows[0];
    const snapshot = (row: typeof first) => ({ ...empty, identities: [{ id: row.id, source_job_id: row.source_job_id,
      first_seen_at: row.first_seen_at, duplicate_posting_ids: row.duplicate_posting_ids }] });
    const later = new Date(now.getTime() + 86_400_000);
    const second = prepareBoard(target, { jobs: [sibling, original] }, later, snapshot(first)).rows;
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: first.id, source_job_id: "5", first_seen_at: first.first_seen_at });
    expect(second[0].duplicate_posting_ids).toContain("greenhouse:example:3");
    const third = prepareBoard(target, { jobs: [sibling] }, later, snapshot(second[0])).rows;
    expect(third).toHaveLength(1);
    expect(third[0]).toMatchObject({ id: first.id, source_job_id: "5", observed_source_job_id: "3", first_seen_at: first.first_seen_at });
  });

  it("rejects inconsistent snapshot ownership instead of guessing", () => {
    const empty = { source: target.source, tenant: target.tenant, complete: true, identities: [] };
    const rows = [3, 5].map((id) => prepareBoard(target, { jobs: [{ ...greenhouseFixture, id }] }, now, empty).rows[0]);
    const snapshot = { ...empty, identities: rows.map((row) => ({ id: row.id, source_job_id: row.source_job_id,
      first_seen_at: row.first_seen_at, duplicate_posting_ids: [] as string[] })) };
    snapshot.identities[0].duplicate_posting_ids = ["greenhouse:example:5"];
    expect(() => prepareBoard(target, { jobs: [greenhouseFixture] }, now, snapshot)).toThrow("Conflicting historical catalog identities");
    expect(() => prepareBoard(target, { jobs: [greenhouseFixture] }, now, { ...empty, tenant: "wrong" })).toThrow("board mismatch");
  });
  it.each([
    ["greenhouse", { jobs: [greenhouseFixture] }],
    ["lever", [leverFixture]],
    ["ashby", { jobs: [ashbyFixture] }],
  ] as const)("normalizes %s without archive state", async (source, body) => {
    listings = body;
    const summary = await run([{ ...target, source }]);
    expect(operations()).toEqual(["publish_batch", "complete_board"]);
    expect(JSON.parse(bodies[0])).toMatchObject({ run_id: runId, source, tenant: "example", batch_no: 0 });
    expect(JSON.parse(bodies[1])).toMatchObject({ batches_expected: 1, fetched_count: 1, accepted_count: 1 });
    expect(summary).toMatchObject({ failed: 0, requests: 4, collector_requests: 3 });
    expect(summary.payload_bytes).toBe(fetchMock.mock.calls.filter(([url]) => String(url) === endpoint).reduce((total, [, init]) => total + Buffer.byteLength(String(init?.body)), 0));
    const headers = fetchMock.mock.calls.find(([url]) => String(url) === endpoint)![1]!.headers;
    expect(headers).toMatchObject({ Authorization: `Bearer ${token}`, "x-vercel-protection-bypass": bypass });
  });

  it("retries identical bytes after 503 without duplicate rows or date changes", async () => {
    const saved = new Map<string, Payload>();
    endpointHandler = (body, call) => {
      if (body.operation !== "publish_batch") return json(complete);
      for (const row of body.rows) if (!saved.has(row.id)) saved.set(row.id, row);
      if (call === 1) return json({}, 503); // committed, response lost
      return json({ accepted: body.rows.length, results: body.rows.map((row: Payload) => ({ id: row.id, outcome: "unchanged" })) });
    };
    const summary = await run();
    expect(bodies[1]).toBe(bodies[0]);
    expect(saved.size).toBe(1);
    expect([...saved.values()][0].first_seen_at).toBe(now.toISOString());
    expect(operations()).toEqual(["publish_batch", "publish_batch", "complete_board"]);
    expect(summary.requests).toBe(5);
  });

  it.each([429, "timeout"] as const)("retries publish on %s", async (failure) => {
    endpointHandler = (body, call) => {
      if (call === 1) {
        if (failure === "timeout") throw new DOMException("Timeout", "TimeoutError");
        return json({}, failure);
      }
      return body.operation === "complete_board" ? json(complete) : json({ accepted: 1, results: [{ id: body.rows[0].id, outcome: "inserted" }] });
    };
    await run();
    expect(bodies[0]).toBe(bodies[1]);
    expect(operations().at(-1)).toBe("complete_board");
  });

  it.each(["http", "json", "identity", "normalize", "partial", "conflict"])("reports %s fetch failure and never publishes or completes", async (failure) => {
    if (failure === "http") sourceHandler = () => json({}, 503);
    if (failure === "json") sourceHandler = () => new Response("{unfinished");
    if (failure === "identity") listings = { jobs: [greenhouseFixture, { ...greenhouseFixture, id: "" }] };
    if (failure === "normalize") listings = { jobs: [{ ...greenhouseFixture, title: null }] };
    if (failure === "partial") listings = { jobs: [greenhouseFixture], meta: { total: 2 } };
    if (failure === "conflict") listings = { jobs: [greenhouseFixture, { ...greenhouseFixture, title: "Different" }] };
    await expect(run()).rejects.toThrow("1 board(s) failed");
    expect(operations()).toEqual(["board_fetch_failed"]);
    expect(JSON.parse(bodies[0])).toMatchObject({ run_id: runId, source: target.source, tenant: target.tenant });
    expect(logs.map((line) => JSON.parse(line)).some((line) => line.stage === "fetch" && line.reason)).toBe(true);
  });

  it("continues other boards while failing the overall run", async () => {
    let calls = 0;
    sourceHandler = () => ++calls === 1 ? json({}, 404) : json({ jobs: [ashbyFixture] });
    await expect(run([target, { ...target, source: "ashby" }])).rejects.toThrow("1 board(s) failed");
    expect(operations()).toContain("board_fetch_failed");
    expect(operations()).toContain("complete_board");
    expect(JSON.parse(bodies.find((body) => JSON.parse(body).operation === "complete_board")!).source).toBe("ashby");
  });

  it("does not complete after a later batch fails permanently", async () => {
    listings = { jobs: manyJobs(18) };
    endpointHandler = (body) => body.batch_no === 0
      ? json({ accepted: body.rows.length, results: body.rows.map((row: Payload) => ({ id: row.id, outcome: "inserted" })) })
      : json({}, 503);
    await expect(run()).rejects.toThrow("1 board(s) failed");
    expect(operations()).not.toContain("complete_board");
    expect(bodies).toHaveLength(5);
    expect(new Set(bodies.slice(1)).size).toBe(1);
    expect(logs.some((line) => line.includes("HTTP 503"))).toBe(true);
  });

  it.each(["missing", "unknown", "duplicate", "count"])("rejects %s publish acknowledgments", async (mode) => {
    endpointHandler = (body) => {
      const result = { id: body.rows[0].id, outcome: "inserted" };
      return json({ accepted: mode === "count" ? 0 : 1, results: mode === "missing" ? [] : mode === "unknown" ? [{ ...result, id: "unknown" }] : mode === "duplicate" ? [result, result] : [result] });
    };
    await expect(run()).rejects.toThrow("1 board(s) failed");
    expect(operations()).toEqual(["publish_batch"]);
  });

  it("fails completion 409 immediately without retrying", async () => {
    listings = { jobs: [] };
    endpointHandler = () => json({}, 409);
    await expect(run()).rejects.toThrow("1 board(s) failed");
    expect(operations()).toEqual(["complete_board"]);
    expect(logs.some((line) => JSON.parse(line).stage === "complete" && line.includes("HTTP 409"))).toBe(true);
  });

  it("completes a valid empty board with zero batches for the backend guard", async () => {
    listings = { jobs: [] };
    await run();
    expect(operations()).toEqual(["complete_board"]);
    expect(JSON.parse(bodies[0])).toMatchObject({ fetched_count: 0, accepted_count: 0, batches_expected: 0 });
  });

  it("splits by serialized UTF-8 size, preserving rows exactly once", async () => {
    listings = { jobs: manyJobs(18) };
    await run();
    const batches = bodies.map((body) => JSON.parse(body)).filter((body) => body.operation === "publish_batch");
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.map((batch) => batch.batch_no)).toEqual(batches.map((_, i) => i));
    for (const body of bodies) expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(new Set(batches.flatMap((batch) => batch.rows.map((row: Payload) => row.id))).size).toBe(18);
    expect(JSON.parse(bodies.at(-1)!)).toMatchObject({ accepted_count: 18, fetched_count: 18, batches_expected: batches.length });
  });

  it("fails before publication if a single row cannot fit", () => {
    const row = toCatalogRow(ADAPTERS.greenhouse.normalize(greenhouseFixture, "example", "Example"), { firstSeenAt: now.toISOString(), duplicates: [], attribution: ADAPTERS.greenhouse.attribution("example") });
    row.description = "😀".repeat(MAX_BATCH_BYTES);
    expect(() => splitBatches({ run_id: runId, source: "greenhouse", tenant: "example" }, [row])).toThrow("Single catalog row");
  });

  it("dedupes only within the board and gates rejected jobs", () => {
    const prepared = prepareBoard(target, { jobs: [greenhouseFixture, { ...greenhouseFixture, id: 2 }, { ...greenhouseFixture, id: 3, internal_job_id: 200, content: "short" }] }, now, { source: target.source, tenant: target.tenant, complete: true, identities: [] });
    expect(prepared).toMatchObject({ fetched_count: 3, gates: { accepted: 1, rejected: 2 } });
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0].duplicate_posting_ids).toEqual(["greenhouse:example:2"]);
  });
});

describe("safe diagnostics and runner restrictions", () => {
  it("keeps stage and board while suppressing credentials, endpoint and bodies", async () => {
    const requestBody = "PRIVATE_REQUEST_BODY";
    sourceHandler = () => { throw new Error(`${token} ${bypass} ${endpoint} ${requestBody} timeout`); };
    await expect(run()).rejects.toThrow();
    const output = logs.join("\n");
    for (const secret of [token, bypass, endpoint, requestBody]) {
      expect(output).not.toContain(secret);
      expect(bodies.join("\n")).not.toContain(secret);
    }
    const line = logs.map((line) => JSON.parse(line)).find((line) => line.reason === "Request timeout");
    expect(line).toMatchObject({ stage: "fetch", board: "greenhouse:example" });
    expect(errorLine("publish", "run", new CollectorError(`${token} ${bypass} ${endpoint}`))).not.toContain(token);
    expect(errorLine("publish", "run", new Error(`${requestBody} ${token}`))).not.toContain(requestBody);
  });

  it("reports backend status without logging its error response", async () => {
    endpointHandler = () => json({ error: `${token} ${bypass} ${endpoint} SECRET_BODY` }, 401);
    await expect(run()).rejects.toThrow();
    expect(logs.join("\n")).toContain("HTTP 401");
    for (const secret of [token, bypass, endpoint, "SECRET_BODY"]) expect(logs.join("\n")).not.toContain(secret);
    expect(operations()).toEqual(["publish_batch"]);
  });

  it("rejects untrusted runner contexts", () => {
    const env = { GITHUB_REPOSITORY: "varveta/applysmooth-data-fetch", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch" };
    expect(() => assertRunnerContext(env)).not.toThrow();
    for (const patch of [{ GITHUB_REF: "refs/heads/feature" }, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REPOSITORY: "fork/repo" }])
      expect(() => assertRunnerContext({ ...env, ...patch })).toThrow("Untrusted runner");
  });

  it("rejects duplicate targets before any network requests", async () => {
    await expect(run([target, target])).rejects.toThrow("Duplicate configured board");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no runtime dependency on checkpoint or archive modules", () => {
    for (const file of ["ingest/stateless.ts", "ingest/lib/collector-client.ts", "ingest/lib/diagnostics.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from ["'][^"']*(?:checkpoint|remote-state|runner-cache|store)["']/);
    }
  });
});
