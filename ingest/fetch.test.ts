import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { greenhouseFixture } from "./synthetic-fixtures";
import { fetchAll, syncTargets } from "./lib/fetch";
import { openStore, type Store } from "./lib/store";

let dir: string;
let db: Store;
let listing: unknown[];
let responseStatus: number;
let runId: number;

const job = (id: number) => ({ ...greenhouseFixture, id });
const fetchSnapshot = () => fetchAll(db, ++runId, {}, () => undefined);
const closedIds = () =>
  db
    .prepare(
      "select source_job_id from postings where status = 'closed' order by source_job_id",
    )
    .all()
    .map((row) => Number(row.source_job_id))
    .sort((a, b) => a - b);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jobs-fetch-"));
  db = openStore(join(dir, "jobs.sqlite"));
  syncTargets(db, [
    { source: "greenhouse", tenant: "stripe", company: "Stripe" },
  ]);
  listing = [];
  responseStatus = 200;
  runId = 0;
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ jobs: listing }), {
        status: responseStatus,
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("source snapshot integrity", () => {
  it("keeps the current raw version latest when source content reverts to an older version", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const original = job(1);
    listing = [original];
    await fetchSnapshot();
    vi.setSystemTime(new Date("2026-10-21T13:00:00Z"));
    listing = [{ ...original, title: "Corrected title" }];
    await fetchSnapshot();
    vi.setSystemTime(new Date("2026-10-21T14:00:00Z"));
    listing = [original];
    await fetchSnapshot();

    const versions = db
      .prepare("select payload_gz from raw_payloads order by fetched_at desc")
      .all();
    expect(versions).toHaveLength(2);
    expect(
      JSON.parse(
        gunzipSync(versions[0].payload_gz as Uint8Array).toString("utf8"),
      ),
    ).toEqual(original);
  });

  it.each([undefined, "", " \t\n ", "x".repeat(121)])(
    "does not change postings when a listing contains invalid ID %j",
    async (id) => {
      listing = [job(1), job(2)];
      await fetchSnapshot();
      const before = db.prepare("select * from postings order by id").all();
      listing = [
        { ...job(1), title: "Changed title" },
        { ...job(2), id },
      ];

      expect(await fetchSnapshot()).toMatchObject({
        failed: 1,
        ok: 0,
        closed: 0,
      });
      expect(closedIds()).toEqual([]);
      expect(db.prepare("select * from postings order by id").all()).toEqual(
        before,
      );
      expect(
        db
          .prepare(
            "select complete from run_targets order by rowid desc limit 1",
          )
          .get(),
      ).toEqual({ complete: 0 });
    },
  );

  it("preserves valid source identities byte-for-byte across all adapters", () => {
    for (const adapter of Object.values(ADAPTERS)) {
      for (const id of [" x ", "x".repeat(120), "00123"]) {
        expect(adapter.postingId({ id })).toBe(id);
      }
      expect(adapter.postingId({ id: 123 })).toBe("123");
    }
  });

  it("rolls back a snapshot when its successful audit cannot be recorded", async () => {
    listing = [job(1), job(2)];
    await fetchSnapshot();
    const before = {
      postings: db.prepare("select * from postings order by id").all(),
      raw: db
        .prepare("select * from raw_payloads order by posting_id, payload_hash")
        .all(),
      targets: db.prepare("select * from targets").all(),
    };
    db.exec(`create trigger reject_success_log before insert on run_targets
      when new.complete = 1
      begin select raise(abort, 'injected audit failure'); end;`);
    listing = [{ ...job(1), title: "Changed title" }, job(3)];

    expect(await fetchSnapshot()).toMatchObject({
      ok: 0,
      errors: 1,
      new: 0,
      changed: 0,
      closed: 0,
    });
    expect(db.prepare("select * from postings order by id").all()).toEqual(
      before.postings,
    );
    expect(
      db
        .prepare("select * from raw_payloads order by posting_id, payload_hash")
        .all(),
    ).toEqual(before.raw);
    expect(db.prepare("select * from targets").all()).toEqual(before.targets);
    expect(
      db
        .prepare("select ok, complete, error from run_targets where run_id = ?")
        .all(runId),
    ).toEqual([
      { ok: 0, complete: 0, error: "internal error: injected audit failure" },
    ]);
  });

  it("confirms each missing job across large drops instead of treating a different drop as agreement", async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => job(i + 1));
    listing = jobs;
    await fetchSnapshot();

    listing = jobs.slice(0, 20);
    expect(await fetchSnapshot()).toMatchObject({ closeHeld: 30, closed: 0 });
    expect(closedIds()).toEqual([]);

    listing = jobs.slice(20, 40);
    expect(await fetchSnapshot()).toMatchObject({ closeHeld: 20, closed: 10 });
    expect(closedIds()).toEqual(Array.from({ length: 10 }, (_, i) => i + 41));

    expect(await fetchSnapshot()).toMatchObject({ closeHeld: 0, closed: 20 });
    expect(closedIds()).toEqual([
      ...Array.from({ length: 20 }, (_, i) => i + 1),
      ...Array.from({ length: 10 }, (_, i) => i + 41),
    ]);
  });

  it("disables a board only after three consecutive not-found responses", async () => {
    responseStatus = 400;
    await fetchSnapshot();
    await fetchSnapshot();
    responseStatus = 404;
    await fetchSnapshot();
    expect(db.prepare("select enabled from targets").get()).toEqual({
      enabled: 1,
    });
    responseStatus = 410;
    await fetchSnapshot();
    expect(db.prepare("select enabled from targets").get()).toEqual({
      enabled: 1,
    });
    await fetchSnapshot();
    expect(db.prepare("select enabled from targets").get()).toEqual({
      enabled: 0,
    });
  });
});
