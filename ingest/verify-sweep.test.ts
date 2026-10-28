import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ashbyFixture } from "./synthetic-fixtures";
import { runVerificationSweep } from "./verify-sweep";
import type { VerifyJob } from "./verify";

afterEach(() => vi.unstubAllGlobals());
const job = (id: string): VerifyJob => ({ id: `catalog-${id}`, source: "ashby", tenant: "example",
  source_job_id: id, apply_url: `https://jobs.ashbyhq.com/example/${id}`, reason: "due" });
function clientFor(pages: VerifyJob[][]) {
  const reported: string[] = [];
  let queues = 0;
  const client = { metrics: { requests: 0, payload_bytes: 0 }, call: async (body: unknown) => {
    client.metrics.requests++;
    const value = body as { operation: string; results?: { id: string }[] };
    if (value.operation === "verify_queue") return { run_id: randomUUID(), jobs: pages[queues++] ?? [] };
    reported.push(...value.results!.map((row) => row.id));
    return { recorded: value.results!.length, withdrawn: 0, flagged: 0 };
  } };
  return { client, reported };
}
it("drains multiple queue batches while fetching a provider board only once", async () => {
  const fetch = vi.fn(async (url: string | URL | Request) => String(url).includes("posting-api")
    ? new Response(JSON.stringify({ jobs: ["1", "2", "3"].map((id) => ({ ...ashbyFixture, id })) }))
    : new Response("Apply"));
  vi.stubGlobal("fetch", fetch);
  const { client, reported } = clientFor([[job("1")], [job("2")], [job("3")], []]);
  const result = await runVerificationSweep({ client, limit: 1, log: () => {} });
  expect(result).toMatchObject({ jobs_checked: 3, recorded: 3, batches: 4, source_and_link_requests: 4 });
  expect(reported).toEqual(["catalog-1", "catalog-2", "catalog-3"]);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes("posting-api"))).toHaveLength(1);
});
it("stops repeated queue identities before another result could increment failure counters", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("temporarily unavailable", { status: 503 })));
  const { client, reported } = clientFor([[job("1")], [job("1")]]);
  await expect(runVerificationSweep({ client, limit: 1, log: () => {} })).rejects.toThrow("repeated a job");
  expect(reported).toEqual(["catalog-1"]);
});
it("alerts when the bounded daily sweep cannot confirm the queue is drained", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("temporarily unavailable", { status: 503 })));
  const { client, reported } = clientFor([[job("1")], [job("2")]]);
  await expect(runVerificationSweep({ client, limit: 1, maxBatches: 2, log: () => {} })).rejects.toThrow("capacity");
  expect(reported).toEqual(["catalog-1", "catalog-2"]);
});
