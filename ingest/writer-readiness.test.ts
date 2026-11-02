import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AUDITED_BOARDS, MAX_RESPONSE_BYTES, VERIFIED_TEST_ENDPOINT,
  matchesAuditedConfiguration, runWriterReadiness, trustedReadinessRunner,
} from "./writer-readiness";

const config = JSON.parse(readFileSync("ingest/config/sources.json", "utf8"));
const active = [...new Set(AUDITED_BOARDS.map(board => board.split(":")[0]))];
const token = "synthetic-private-token-".repeat(3);
const bypass = "synthetic-private-bypass";
const responseFor = (init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  return { source: body.source, tenant: body.tenant, complete: true, identities: [] };
};
function setup(fetcher = vi.fn<typeof fetch>(async (_url, init) => Response.json(responseFor(init)))) {
  const logs: string[] = [];
  const wait = vi.fn(async (_ms: number) => {});
  const options = { config, activeSourcesJson: JSON.stringify(active), endpoint: VERIFIED_TEST_ENDPOINT,
    token, bypass, fetcher, wait, log: (line: string) => logs.push(line) };
  return { options, logs, wait, fetcher };
}

it("reads exactly the 49 configured boards serially with empty identity scope and no retries", async () => {
  const { options, logs, fetcher, wait } = setup();
  const report = await runWriterReadiness(options);
  expect(report).toEqual({ endpoint_matches_verified_TEST_alias: true, configuration_matches_audited_boards: true,
    credentials_present: true, expected_boards: 49, checked_boards: 49, passed_boards: 49, failed_boards: 0, success: true });
  expect(fetcher).toHaveBeenCalledTimes(49);
  expect(wait).toHaveBeenCalledTimes(48);
  expect(wait.mock.calls.every(([ms]) => ms === 1000)).toBe(true);
  expect(fetcher.mock.invocationCallOrder[0]).toBeLessThan(wait.mock.invocationCallOrder[0]);
  expect(wait.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[1]);
  const ids = new Set();
  fetcher.mock.calls.forEach(([url, init], index) => {
    expect(url).toBe(VERIFIED_TEST_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${token}`, "x-vercel-protection-bypass": bypass } });
    const [source, tenant] = AUDITED_BOARDS[index].split(":");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ operation: "board_identities", run_id: expect.any(String), source, tenant, posting_ids: [] });
    expect(body.run_id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    ids.add(body.run_id);
  });
  expect(ids.size).toBe(1);
  expect(logs).toHaveLength(50);
  expect(logs.join("\n")).not.toContain(token);
  expect(logs.join("\n")).not.toContain(bypass);
  expect(logs.join("\n")).not.toContain(VERIFIED_TEST_ENDPOINT);
  expect(JSON.parse(logs[0])).toEqual({ board: "ashby:cohere", http_status: 200,
    valid_identity_response: true, requested_identity_count: 0, returned_identity_count: 0 });
});

it.each([
  undefined, "https://different.example.com/api/jobs-collector", VERIFIED_TEST_ENDPOINT + "/",
  VERIFIED_TEST_ENDPOINT + "?secret=synthetic", VERIFIED_TEST_ENDPOINT.replace("https:", "http:"),
])("stops an endpoint mismatch before sending credentials (%s)", async endpoint => {
  const { options, logs, fetcher } = setup();
  expect(await runWriterReadiness({ ...options, endpoint })).toMatchObject({
    endpoint_matches_verified_TEST_alias: false, checked_boards: 0, success: false,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(logs).toHaveLength(1);
  if (endpoint) expect(logs[0]).not.toContain(endpoint);
});

it.each([undefined, "short"])("stops missing credentials before requests", async invalidToken => {
  const { options, fetcher } = setup();
  expect(await runWriterReadiness({ ...options, token: invalidToken })).toMatchObject({ credentials_present: false, checked_boards: 0 });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([401, 403, 429, 503, 302, 307])("stops after HTTP %i without retries, redirects or response disclosure", async status => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(`${token} ${bypass}`, {
    status, headers: { Location: "https://unapproved.example.com/" },
  }));
  const { options, logs, wait } = setup(fetcher);
  expect(await runWriterReadiness(options)).toMatchObject({ checked_boards: 1, passed_boards: 0, failed_boards: 1, success: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(wait).not.toHaveBeenCalled();
  expect(JSON.parse(logs[0])).toMatchObject({ http_status: status, valid_identity_response: false });
  expect(logs.join("\n")).not.toContain(token);
  expect(logs.join("\n")).not.toContain(bypass);
  expect(logs.join("\n")).not.toContain("unapproved.example.com");
});

it.each([
  { source: "lever" }, { tenant: "another-tenant" }, { complete: false },
  { identities: [{ id: "private-history" }] }, { unexpected: "private-response-value" },
])("rejects incomplete, wrong-scope or nonempty identity responses without printing content", async change => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => Response.json({ ...responseFor(init), ...change }));
  const { options, logs } = setup(fetcher);
  expect(await runWriterReadiness(options)).toMatchObject({ checked_boards: 1, failed_boards: 1, success: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(logs.join("\n")).not.toContain("private-history");
  expect(logs.join("\n")).not.toContain("another-tenant");
  expect(logs.join("\n")).not.toContain("private-response-value");
});

it("rejects malformed JSON and suppresses its contents", async () => {
  const { options, logs } = setup(vi.fn(async () => new Response(`{ malformed ${token}`)));
  expect(await runWriterReadiness(options)).toMatchObject({ failed_boards: 1, success: false });
  expect(logs.join("\n")).not.toContain(token);
  expect(logs.join("\n")).not.toContain("malformed");
});

it.each([true, false])("bounds oversized responses even with an absent length header (%s)", async lengthHeader => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(MAX_RESPONSE_BYTES + 1))); },
    cancel,
  });
  const { options, fetcher } = setup(vi.fn(async () => new Response(stream, {
    headers: lengthHeader ? { "Content-Length": String(MAX_RESPONSE_BYTES + 1) } : {},
  })));
  expect(await runWriterReadiness(options)).toMatchObject({ failed_boards: 1, success: false });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("suppresses network/timeout/redirect exception details containing credentials", async () => {
  const { options, logs, fetcher } = setup(vi.fn(async () => {
    throw new Error(`${VERIFIED_TEST_ENDPOINT} ${token} ${bypass}`);
  }));
  expect(await runWriterReadiness(options)).toMatchObject({ failed_boards: 1, success: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(logs[0]).http_status).toBeNull();
  for (const secret of [VERIFIED_TEST_ENDPOINT, token, bypass]) expect(logs.join("\n")).not.toContain(secret);
});

it("refuses a response that a fetch implementation already redirected", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const response = Response.json(responseFor(init));
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  const { options } = setup(fetcher);
  expect(await runWriterReadiness(options)).toMatchObject({ failed_boards: 1, success: false });
});

describe("trusted scope", () => {
  const runner = { GITHUB_REPOSITORY: "varveta/applysmooth-data-fetch", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch" };
  it("allows only manual runs from the expected repository and main branch", () => {
    expect(trustedReadinessRunner(runner)).toBe(true);
    for (const change of [{ GITHUB_REF: "refs/heads/TEST" }, { GITHUB_EVENT_NAME: "schedule" },
      { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REPOSITORY: "someone/fork" }])
      expect(trustedReadinessRunner({ ...runner, ...change })).toBe(false);
  });
  it("requires the exact active 49-board configuration", async () => {
    expect(matchesAuditedConfiguration(config, JSON.stringify(active))).toBe(true);
    const changed = structuredClone(config);
    changed.sources.ashby.targets[0].tenant = "unexpected";
    for (const [candidate, sources] of [[changed, JSON.stringify(active)], [config, "[]"],
      [config, "not-json"], [config, JSON.stringify([...active, active[0]])], [config, JSON.stringify(active.slice(1))]]) {
      const { options, fetcher, logs } = setup();
      expect(await runWriterReadiness({ ...options, config: candidate, activeSourcesJson: String(sources) }))
        .toMatchObject({ configuration_matches_audited_boards: false, checked_boards: 0, success: false });
      expect(fetcher).not.toHaveBeenCalled();
      expect(logs.join("\n")).not.toContain("unexpected");
    }
  });
  it("keeps workflow manual-only, main-only, read-permissioned and without artifacts or checkpoint actions", () => {
    const workflow = readFileSync(".github/workflows/writer-readiness.yml", "utf8");
    expect(workflow).toContain("on:\n  workflow_dispatch:\npermissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("github.repository == 'varveta/applysmooth-data-fetch'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("environment: test");
    expect(workflow).not.toMatch(/\n  (schedule|push|pull_request):/);
    expect(workflow).not.toMatch(/upload-artifact|cache\/restore|ingest\/scheduled|permissions:[\s\S]*contents: write/);
  });
});
