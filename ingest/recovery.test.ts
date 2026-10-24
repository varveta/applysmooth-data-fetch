import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "./lib/store";
import { fetchAll, syncTargets } from "./lib/fetch";
import { gateAll } from "./lib/gate";
import { applyPlan, buildPlan, type CatalogWriter } from "./lib/publish";
import { greenhouseFixture } from "./synthetic-fixtures";
it("replays an ambiguous publish acknowledgement without a second identity or reset window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-"));
  const db = openStore(join(dir, "jobs.sqlite"));
  const rows = new Map<
    string,
    {
      id: string;
      outcome: "inserted" | "unchanged";
      published_at: string;
      expires_at: string;
    }
  >();
  let loseAck = true;
  const writer: CatalogWriter = {
    label: "test",
    publish: async (batch) => {
      const result = batch.map((row) => {
        const existing = rows.get(row.id);
        if (existing) return { ...existing, outcome: "unchanged" as const };
        const outcome = {
          id: row.id,
          outcome: "inserted" as const,
          published_at: "2026-10-24T12:00:00Z",
          expires_at: "2026-11-08T12:00:00Z",
        };
        rows.set(row.id, outcome);
        return outcome;
      });
      if (loseAck) {
        loseAck = false;
        throw Error("lost response after commit");
      }
      return result;
    },
    withdraw: async () => [],
    lifecycle: async () => ({}),
    readState: async () => [],
    readPublic: async () => [],
    close: async () => {},
  };
  try {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            jobs: [
              {
                ...greenhouseFixture,
                first_published: new Date().toISOString(),
              },
            ],
          }),
        ),
    );
    syncTargets(db, [
      { source: "greenhouse", tenant: "example", company: "Example" },
    ]);
    await fetchAll(db, 1, {}, () => {});
    gateAll(db, 1);
    const plan = buildPlan(db, new Date(), 40, writer.label);
    expect(plan.publish).toHaveLength(1);
    await expect(applyPlan(db, 1, plan, writer, 10)).rejects.toThrow(
      "lost response",
    );
    expect(rows.size).toBe(1);
    expect(db.prepare("select count(*) n from publish_targets").get()?.n).toBe(
      0,
    );
    expect(await applyPlan(db, 1, plan, writer, 10)).toEqual({ unchanged: 1 });
    expect(rows.size).toBe(1);
    expect(
      db
        .prepare("select first_published_at,expires_at from publish_targets")
        .get(),
    ).toMatchObject({
      first_published_at: "2026-10-24T12:00:00Z",
      expires_at: "2026-11-08T12:00:00Z",
    });
  } finally {
    vi.unstubAllGlobals();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
