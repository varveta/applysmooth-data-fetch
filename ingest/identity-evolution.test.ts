import { describe, expect, it } from "vitest";
import { publicJobId } from "@/lib/jobs-ingest/catalog";
import { boardIdentities, type BoardIdentity } from "./lib/board-identities";
import { prepareBoard, runStateless, type StatelessCatalogRow, type StatelessTarget } from "./stateless";
import { greenhouseFixture } from "./synthetic-fixtures";

const target: StatelessTarget = { source: "greenhouse", tenant: "example", company: "Example" };
const now = new Date("2026-10-26T12:00:00Z");
const posting = (id: number) => `greenhouse:example:${id}`;
const anchor = (id: number, aliases: number[] = []): BoardIdentity => ({
  id: publicJobId(posting(id)), source_job_id: String(id), first_seen_at: "2026-10-23T12:00:00Z",
  duplicate_posting_ids: aliases.map(posting),
});
const snapshot = (identities: BoardIdentity[]) => ({ source: target.source, tenant: target.tenant, complete: true, identities });
const job = (id: number, title = "Data Engineer") => ({ ...greenhouseFixture, id, title });
const prepare = (jobs: unknown[], identities: BoardIdentity[]) => prepareBoard(target, { jobs }, now, snapshot(identities));
const checkCounts = (prepared: ReturnType<typeof prepareBoard>) => {
  expect(prepared.gates.accepted ?? 0).toBe(prepared.rows.length);
  expect(Object.values(prepared.gates).reduce((sum, count) => sum + count, 0)).toBe(prepared.fetched_count);
};

describe("historical identities survive changes in current duplicate groups", () => {
  it("keeps one ID when aliases split without stopping unrelated jobs", () => {
    const prepared = prepare([job(5), job(3, "Analytics Engineer"), job(99, "Security Engineer")], [anchor(5, [3])]);
    expect(prepared.rows.map((row) => row.source_job_id).sort()).toEqual(["5", "99"]);
    expect(prepared.rows.find((row) => row.source_job_id === "5")).toMatchObject({
      id: anchor(5).id, observed_source_job_id: "5", first_seen_at: anchor(5).first_seen_at,
      duplicate_posting_ids: [posting(3)],
    });
    expect(prepared.identity_resolution).toMatchObject({ splits: 1, quarantined: 1 });
    expect(prepared.quarantined_posting_ids).toEqual([posting(3)]);
    expect(prepared.quarantined_count).toBe(1);
    checkCounts(prepared);
  });

  it("keeps two existing IDs when current dedupe groups merge and quarantines new ambiguous members", () => {
    const identities = [anchor(5, [3]), anchor(8, [7])];
    const jobs = [job(3), job(5), job(7), job(8), job(9), job(99, "Security Engineer")];
    const prepared = prepare(jobs, identities);
    expect(prepared.rows.map((row) => row.source_job_id).sort()).toEqual(["5", "8", "99"]);
    for (const historical of identities) {
      const row = prepared.rows.find((row) => row.id === historical.id)!;
      expect(row).toMatchObject({ ...historical, observed_source_job_id: historical.source_job_id });
      expect(row.duplicate_posting_ids).not.toContain(posting(9));
    }
    expect(prepared.identity_resolution).toMatchObject({ merges: 1, quarantined: 1 });
    expect(() => boardIdentities(snapshot(prepared.rows), target.source, target.tenant)).not.toThrow();
    expect(prepare([...jobs].reverse(), [...identities].reverse()).rows).toEqual(prepared.rows);
    checkCounts(prepared);
  });

  it("does not mix locations or adopt a new posting from the unselected split branch", () => {
    const boston = { ...job(3, "Analytics Engineer"), location: { name: "Boston, MA, United States" }, offices: [] };
    const freshBoston = { ...boston, id: 4 };
    const prepared = prepare([job(5), boston, freshBoston], [anchor(5, [3])]);
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0].locations.map((location) => location.city)).not.toContain("Boston");
    expect(prepared.rows[0].duplicate_posting_ids).toEqual([posting(3)]);
    expect(prepared.identity_resolution).toMatchObject({ splits: 1, quarantined: 2 });
    checkCounts(prepared);
  });

  it("uses an accepted alias when the original fails quality gates", () => {
    const prepared = prepare([{ ...job(5), content: "too short" }, job(3)], [anchor(5, [3])]);
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0]).toMatchObject({ id: anchor(5).id, source_job_id: "5", observed_source_job_id: "3", first_seen_at: anchor(5).first_seen_at });
    checkCounts(prepared);
  });

  it("emits a deterministic surviving alias for an absent original, without inventing unseen rows", () => {
    const jobs = [job(7, "Analytics Engineer"), job(3)];
    const identities = [anchor(5, [3, 7]), anchor(88)];
    const prepared = prepare(jobs, identities);
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0]).toMatchObject({ id: anchor(5).id, source_job_id: "5", observed_source_job_id: "3" });
    expect(prepare([...jobs].reverse(), [...identities].reverse()).rows).toEqual(prepared.rows);
    checkCounts(prepared);
  });

  it("prefers a known alias over a new lower-ID member of another split branch", () => {
    const identities = [anchor(5, [7, 9])];
    const jobs = [job(7), job(9, "Analytics Engineer")];
    const before = prepare(jobs, identities).rows[0];
    const after = prepare([...jobs, job(3, "Analytics Engineer")], identities);
    expect(after.rows[0]).toMatchObject({ id: before.id, observed_source_job_id: "7", title: before.title,
      duplicate_posting_ids: [posting(7), posting(9)] });
    expect(after.identity_resolution).toMatchObject({ splits: 1, quarantined: 2 });
    checkCounts(after);
  });

  it.each(["split", "merge"] as const)("publishes all safe rows and completes a board after a %s", async (mode) => {
    const jobs = [job(5), job(3, mode === "split" ? "Analytics Engineer" : "Data Engineer"), job(99, "Security Engineer")];
    const identities = mode === "split" ? [anchor(5, [3])] : [anchor(5), anchor(3)];
    const calls: Record<string, unknown>[] = [];
    const client = {
      metrics: { requests: 0, payload_bytes: 0 },
      async call(input: unknown) {
        const body = input as Record<string, unknown>;
        calls.push(body);
        client.metrics.requests++;
        client.metrics.payload_bytes += Buffer.byteLength(JSON.stringify(input));
        if (body.operation === "board_identities") return snapshot(identities);
        if (body.operation === "publish_batch") {
          const rows = body.rows as StatelessCatalogRow[];
          return { accepted: rows.length, results: rows.map((row) => ({ id: row.id, outcome: "unchanged" })) };
        }
        return { complete: true, missing: 0, withdrawn: 0, marked_uncertain: 0, guard: "none" };
      },
    };
    const summary = await runStateless({ targets: [target], client, now, log: () => {},
      get: async () => ({ ok: true, status: 200, body: { jobs }, bytes: 1000, attempts: 1 }) });
    expect(summary.failed).toBe(0);
    expect(calls.map((body) => body.operation)).toEqual(["board_identities", "publish_batch", "complete_board"]);
    expect(calls.at(-1)).toMatchObject({ fetched_count: 3, accepted_count: mode === "split" ? 2 : 3,
      quarantined_posting_ids: mode === "split" ? [posting(3)] : [], quarantined_count: mode === "split" ? 1 : 0 });
  });
});

it("reports only identity conflicts, excluding ordinary duplicates and quality failures", () => {
  const prepared = prepare([job(5), job(3), {...job(7),content:"too short"}, job(9,"Analytics Engineer")], [anchor(5,[3,7,9])]);
  expect(prepared.quarantined_posting_ids).toEqual([posting(9)]);
  expect(prepared.quarantined_count).toBe(1);
});
it("caps completion IDs at 500 while preserving the full count", async () => {
  const aliases = Array.from({length:501},(_,i)=>i+10);
  const jobs = [job(5),...aliases.map((id)=>job(id,`Separate role ${id}`))];
  let completion: Record<string, unknown> | undefined;
  await runStateless({ targets:[target],now,log:()=>{},
    get:async()=>({ok:true,status:200,body:{jobs},bytes:1000,attempts:1}),
    client:{metrics:{requests:0,payload_bytes:0},async call(input) {
      const body = input as Record<string, unknown>;
      if(body.operation === "board_identities") return snapshot([anchor(5,aliases)]);
      if(body.operation === "publish_batch") {
        const rows = body.rows as StatelessCatalogRow[];
        return {accepted:rows.length,results:rows.map(row=>({id:row.id,outcome:"unchanged"}))};
      }
      completion=body;
      return {complete:true,missing:0,withdrawn:0,marked_uncertain:0,guard:"none"};
    }} });
  expect(completion?.quarantined_count).toBe(501);
  expect(completion?.quarantined_posting_ids).toEqual(aliases.map(posting).sort().slice(0,500));
});
it("publishes a released alias under its own ID while preserving the original identity", () => {
  const before = prepare([job(5),job(3,"Analytics Engineer")],[anchor(5,[3])]);
  const after = prepare([job(5),job(3,"Analytics Engineer")],[anchor(5)]);
  expect(before.rows).toHaveLength(1); expect(after.rows).toHaveLength(2);
  expect(after.rows.find(row=>row.source_job_id==='5')).toMatchObject({id:anchor(5).id,first_seen_at:anchor(5).first_seen_at});
  expect(after.rows.find(row=>row.source_job_id==='3')?.id).toBe(publicJobId(posting(3)));
  expect(after.quarantined_posting_ids).toEqual([]);
});
