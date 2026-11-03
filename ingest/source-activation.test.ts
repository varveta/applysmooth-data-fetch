import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { EXPERIMENTAL_SOURCE_IDS, type SourceId } from "@/lib/jobs-ingest/contract";
import { loadBoard } from "./lib/load-board";
import { isTestOnlySource } from "./lib/source-activation";
import { resolveMode } from "./source-pipeline";
import { runStateless } from "./stateless";
import { verifier, type VerifyJob } from "./verify";

vi.mock("./lib/load-board", async importOriginal => ({
  ...await importOriginal<typeof import("./lib/load-board")>(), loadBoard: vi.fn(),
}));

const description = `<p>${"Build reliable software and maintain production services. ".repeat(12)}</p>`;
const fixtures = {
  remotefirstjobs: {
    id: "software-engineer-123", url: "https://remotefirstjobs.com/companies/example/jobs/software-engineer-123",
    title: "Software Engineer", company_name: "Example", description, locations: ["United States"],
    published_at: "2026-11-02T09:00:00", category: "software-development",
  },
  spacejobs: {
    referencenumber: "2570d7e745f1", title: "Software Engineer", company: "Example Employer",
    url: "https://spacejobs.now/jobs/software-engineer-2570d7e745f1?utm_source=job-feed&utm_medium=job-feed&utm_campaign=us",
    description, location: "Seattle, WA", country: "US", eligibility: "one-country", eligiblecountries: "US",
  },
  railsjobs: {
    title: "Software Engineer at Example Employer", description: `<p>Location: Remote US</p>${description}`,
    pubDate: "Mon, 02 Nov 2026 09:00:00 GMT",
    link: "https://jobs.rubyonrails.org/jobs/1-software-engineer",
    guid: "https://jobs.rubyonrails.org/jobs/1-software-engineer",
  },
};
const approved = ["spacejobs", "railsjobs", "remotefirstjobs"] as const;
const now = new Date("2026-11-02T21:00:00Z");
const getBoard = vi.mocked(loadBoard);
const target = (source: SourceId) => ({ source, tenant: "public", company: "Example feed" });
const queued = (source: typeof approved[number]): VerifyJob => {
  const job = ADAPTERS[source].normalize(fixtures[source], "public");
  return { id: job.id, source, tenant: "public", source_job_id: job.sourceJobId, apply_url: job.applyUrl, reason: "due" };
};
const board = (body: unknown[]) => ({ body, attempts: 1, bytes: 100 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe.each(approved)("approved %s entry guards", source => {
  it("publishes an activated source through the stateless guard and verifies it without TEST opt-in", async () => {
    expect(resolveMode(source, "auto", JSON.stringify([source]))).toBe("publish");
    getBoard.mockResolvedValue(board([fixtures[source]]));
    const call = vi.fn(async (body: unknown) => {
      const request = body as { operation: string; rows?: { id: string }[] };
      if (request.operation === "board_identities")
        return { source, tenant: "public", complete: true, identities: [] };
      if (request.operation === "publish_batch")
        return { accepted: request.rows!.length, results: request.rows!.map(row => ({ id: row.id, outcome: "inserted" })) };
      if (request.operation === "complete_board")
        return { complete: true, missing: 0, withdrawn: 0, marked_uncertain: 0, guard: "partial_snapshot" };
      throw new Error("Unexpected collector operation");
    });
    const logs: string[] = [];
    const summary = await runStateless({ targets: [target(source)], now, log: line => logs.push(line),
      client: { call, metrics: { requests: 0, payload_bytes: 0 } } }).catch(error => { throw new Error(logs.join("\n"), { cause: error }); });
    expect(summary.failed).toBe(0);
    expect(call.mock.calls.map(([body]) => (body as { operation: string }).operation))
      .toEqual(["board_identities", "publish_batch", "complete_board"]);
    expect(call.mock.calls[1][0]).toMatchObject({ source, tenant: "public", rows: [
      { source, source_tenant: "public", attribution_url: queued(source).apply_url },
    ] });
    expect(call.mock.calls[2][0]).toMatchObject({ batches_expected: 1, fetched_count: 1, accepted_count: 1 });
    expect(fetch).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const result = await verifier().check(queued(source));
    expect(result).toMatchObject({ stage: "verify_link", status: "open" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("withholds closure and skips application requests when absent from the observation window", async () => {
    getBoard.mockResolvedValue(board([]));
    const check = verifier();
    expect(await check.check(queued(source))).toMatchObject({ status: "uncertain", stage: "verify_source",
      detail: "Absent from observation feed; closure withheld" });
    expect(await check.check(queued(source))).toMatchObject({ status: "uncertain" });
    expect(getBoard).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("withholds confirmation when a still-valid provider application URL changes", async () => {
    const raw = source === "remotefirstjobs"
      ? { ...fixtures.remotefirstjobs, url: fixtures.remotefirstjobs.url.replace("/example/", "/another/") }
      : source === "spacejobs"
      ? { ...fixtures.spacejobs, url: fixtures.spacejobs.url.replace("software-engineer-", "senior-engineer-") }
      : { ...fixtures.railsjobs, link: fixtures.railsjobs.link.replace("software-engineer", "senior-engineer"),
        guid: fixtures.railsjobs.guid.replace("software-engineer", "senior-engineer") };
    getBoard.mockResolvedValue(board([raw]));
    expect(await verifier().check(queued(source))).toMatchObject({ status: "uncertain",
      detail: "Source application URL changed; confirmation withheld" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("withholds confirmation when US eligibility becomes unclear or excluded", async () => {
    const raw = source === "remotefirstjobs"
      ? { ...fixtures.remotefirstjobs, locations: ["Canada"] }
      : source === "spacejobs"
      ? { ...fixtures.spacejobs, country: "CA", eligiblecountries: "CA", location: "Toronto, Canada" }
      : { ...fixtures.railsjobs, description: `<p>Location: Remote US</p>${description}<p>We cannot hire candidates in the United States.</p>` };
    getBoard.mockResolvedValue(board([raw]));
    expect(await verifier().check(queued(source))).toMatchObject({ status: "uncertain", stage: "verify_source" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

it.each(EXPERIMENTAL_SOURCE_IDS.filter(isTestOnlySource))(
  "keeps unapproved %s blocked at all three entry guards despite runtime activation", async source => {
    expect(() => resolveMode(source, "auto", JSON.stringify([source]))).toThrow("TEST-only");
    const call = vi.fn();
    await expect(runStateless({ targets: [target(source)], log: () => {},
      client: { call, metrics: { requests: 0, payload_bytes: 0 } } })).rejects.toThrow("TEST-only");
    expect(await verifier().check({ id: "catalog", source, tenant: "public", source_job_id: "1",
      apply_url: "https://example.com/jobs/1", reason: "due" })).toMatchObject({ status: "uncertain",
      detail: "TEST-only source has no approved closure verification" });
    expect(call).not.toHaveBeenCalled();
    expect(getBoard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);
