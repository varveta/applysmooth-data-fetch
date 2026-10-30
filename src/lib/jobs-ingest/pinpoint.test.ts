import { describe, expect, it } from "vitest";
import { ADAPTERS, type SourceAdapter } from "./adapters";
import { loadBoard } from "../../../ingest/lib/load-board";
import { resolveMode } from "../../../ingest/source-pipeline";
import { runStateless } from "../../../ingest/stateless";

const adapter = () => (ADAPTERS as Record<string, SourceAdapter>).pinpoint;
const raw = { id: "123", title: "Data Engineer", url: "https://groupo.pinpointhq.com/en/postings/stable-id",
  description: "<p>Build reliable data platforms.</p><script>bad()</script>",
  key_responsibilities: "<p>Maintain pipelines.</p>", skills_knowledge_expertise: "<p>SQL experience.</p>", benefits: "<p>Paid leave.</p>",
  deadline_at: "2026-11-30T12:00:00Z", employment_type: "full_time", workplace_type: "onsite",
  compensation_visible: false, compensation: null,
  location: { name: "Haslet, Texas (405)", city: "Haslet", province: "Texas" },
  job: { id: "456", requisition_id: "REQ-1", department: { name: "Engineering" } } };

describe("experimental Pinpoint normalization", () => {
  it("uses stable posting ID, configured employer and explicit expiry without inventing dates", () => {
    expect(adapter(), "Pinpoint adapter exists").toBeDefined();
    const job = adapter().normalize(raw, "groupo", "Group O");
    expect(job).toMatchObject({ sourceJobId: "123", company: "Group O", requisitionKey: "REQ-1", department: "Engineering",
      postedAt: null, sourceUpdatedAt: null, sourceExpiresAt: "2026-11-30T12:00:00.000Z", usEligibility: "us", workMode: "On-site", jobType: "Full-time" });
    expect(job.descriptionText).toBe("Build reliable data platforms.\nMaintain pipelines.\nSQL experience.\nPaid leave.");
  });
  it("requires configured employer instead of guessing from tenant or platform", () => {
    expect(adapter()).toBeDefined();
    expect(() => adapter().normalize(raw, "groupo")).toThrow();
  });
  it("does not infer US eligibility from remote alone or a missing country", () => {
    expect(adapter()).toBeDefined();
    expect(adapter().normalize({ ...raw, location: { name: "Remote" }, workplace_type: "remote" }, "groupo", "Group O").usEligibility).toBe("unknown");
    expect(adapter().normalize({ ...raw, location: { name: "London, United Kingdom" } }, "groupo", "Group O").usEligibility).toBe("not_us");
  });
  it.each(["https://other.pinpointhq.com/en/postings/123", "https://groupo.pinpointhq.com@attacker.example/123", "http://groupo.pinpointhq.com/123", "https://groupo.pinpointhq.com:444/123"])("refuses off-board URL %s", url => {
    expect(adapter()).toBeDefined();
    expect(() => adapter().normalize({ ...raw, url }, "groupo", "Group O")).toThrow();
  });
  it("rejects duplicate identities and malformed rows before exposing a listing", () => {
    expect(adapter()).toBeDefined();
    expect(adapter().parseListing({ data: [raw] })).toHaveLength(1);
    expect(() => adapter().parseListing({ data: [raw, raw] })).toThrow();
    expect(() => adapter().parseListing({ jobs: [raw] })).toThrow();
    expect(() => adapter().parseListing({ data: [{ ...raw, deadline_at: "tomorrow" }] })).toThrow();
    expect(() => adapter().parseListing({ data: [{ ...raw, id: "" }] })).toThrow();
  });
  it("caps fetch size and marks results observation-only", async () => {
    expect(adapter()).toBeDefined();
    const response = await loadBoard({ source: "pinpoint" as never, tenant: "groupo", company: "Group O" }, async (url, opts) => {
      expect(url).toBe("https://groupo.pinpointhq.com/postings.json");
      expect(opts?.maxBytes).toBe(12_000_000);
      return { ok: true, status: 200, body: { data: [raw] }, bytes: 100, attempts: 1 };
    });
    expect(response).toMatchObject({ discovery: { policy: "observations", pages: 1, capped: false } });
  });
  it("cannot publish even when an operator activates its source ID", async () => {
    expect(() => resolveMode("pinpoint" as never, "publish", '["pinpoint"]')).toThrow(/TEST-only/);
    expect(() => resolveMode("pinpoint" as never, "auto", '["pinpoint"]')).toThrow(/TEST-only/);
    let calls = 0;
    await expect(runStateless({ targets: [{ source: "pinpoint" as never, tenant: "groupo", company: "Group O" }],
      client: { metrics: { requests: 0, payload_bytes: 0 }, call: async () => { calls++; return {}; } },
    })).rejects.toThrow(/TEST-only/);
    expect(calls).toBe(0);
  });
});
