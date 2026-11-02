import { pinpointDetail } from "../../../ingest/lib/fetch-pinpoint";
import { validateTargets } from "../../../ingest/validate-targets";
import { describe, expect, it } from "vitest";
import { ADAPTERS, type SourceAdapter } from "./adapters";
import { loadBoard } from "../../../ingest/lib/load-board";
import { resolveMode } from "../../../ingest/source-pipeline";
import { runStateless } from "../../../ingest/stateless";

const adapter = () => (ADAPTERS as Record<string, SourceAdapter>).pinpoint;
const raw = {
  id: "123",
  title: "Data Engineer",
  url: "https://groupo.pinpointhq.com/en/postings/stable-id",
  description: "<p>Build reliable data platforms.</p><script>bad()</script>",
  key_responsibilities: "<p>Maintain pipelines.</p>",
  skills_knowledge_expertise: "<p>SQL experience.</p>",
  benefits: "<p>Paid leave.</p>",
  deadline_at: "2026-11-30T12:00:00Z",
  employment_type: "full_time",
  workplace_type: "onsite",
  compensation_visible: false,
  compensation: null,
  location: { name: "Haslet, Texas (405)", city: "Haslet", province: "Texas" },
  job: {
    id: "456",
    requisition_id: "REQ-1",
    department: { name: "Engineering" },
  },
};

describe("experimental Pinpoint normalization", () => {
  it("uses stable posting ID, configured employer and explicit expiry without inventing dates", () => {
    expect(adapter(), "Pinpoint adapter exists").toBeDefined();
    const job = adapter().normalize(raw, "groupo", "Group O");
    expect(job).toMatchObject({
      sourceJobId: "123",
      company: "Group O",
      requisitionKey: "REQ-1",
      department: "Engineering",
      postedAt: null,
      sourceUpdatedAt: null,
      sourceExpiresAt: "2026-11-30T12:00:00.000Z",
      usEligibility: "us",
      workMode: "On-site",
      jobType: "Full-time",
    });
    expect(job.descriptionText).toBe(
      "Build reliable data platforms.\nMaintain pipelines.\nSQL experience.\nPaid leave.",
    );
  });
  it("requires configured employer instead of guessing from tenant or platform", () => {
    expect(adapter()).toBeDefined();
    expect(() => adapter().normalize(raw, "groupo")).toThrow();
  });
  it("does not infer US eligibility from remote alone or a missing country", () => {
    expect(adapter()).toBeDefined();
    expect(
      adapter().normalize(
        { ...raw, location: { name: "Remote" }, workplace_type: "remote" },
        "groupo",
        "Group O",
      ).usEligibility,
    ).toBe("unknown");
    expect(
      adapter().normalize(
        { ...raw, location: { name: "London, United Kingdom" } },
        "groupo",
        "Group O",
      ).usEligibility,
    ).toBe("not_us");
  });
  it.each([
    "https://other.pinpointhq.com/en/postings/123",
    "https://groupo.pinpointhq.com@attacker.example/123",
    "http://groupo.pinpointhq.com/123",
    "https://groupo.pinpointhq.com:444/123",
  ])("refuses off-board URL %s", (url) => {
    expect(adapter()).toBeDefined();
    expect(() =>
      adapter().normalize({ ...raw, url }, "groupo", "Group O"),
    ).toThrow();
  });
  it("rejects duplicate identities and malformed rows before exposing a listing", () => {
    expect(adapter()).toBeDefined();
    expect(adapter().parseListing({ data: [raw] })).toHaveLength(1);
    expect(() => adapter().parseListing({ data: [raw, raw] })).toThrow();
    expect(() => adapter().parseListing({ jobs: [raw] })).toThrow();
    expect(() =>
      adapter().parseListing({ data: [{ ...raw, deadline_at: "tomorrow" }] }),
    ).toThrow();
    expect(() =>
      adapter().parseListing({ data: [{ ...raw, id: "" }] }),
    ).toThrow();
  });
  it("caps fetch size and marks results observation-only", async () => {
    expect(adapter()).toBeDefined();
    const response = await loadBoard(
      { source: "pinpoint" as never, tenant: "groupo", company: "Group O" },
      async (url, opts) => {
        if (url.endsWith("/postings.json")) {
          expect(opts?.maxBytes).toBe(12_000_000);
          return {
            ok: true,
            status: 200,
            body: { data: [raw] },
            bytes: 100,
            attempts: 1,
          };
        }
        expect(url).toBe(raw.url);
        return {
          ok: true,
          status: 200,
          bytes: 100,
          attempts: 1,
          body: `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: raw.title, identifier: { value: "stable-id" }, datePosted: "2026-10-26" })}</script>`,
        };
      },
    );
    expect(response).toMatchObject({
      discovery: { policy: "observations", pages: 2, capped: false },
    });
  });
  it("cannot publish even when an operator activates its source ID", async () => {
    expect(() =>
      resolveMode("pinpoint" as never, "publish", '["pinpoint"]'),
    ).toThrow(/TEST-only/);
    expect(() =>
      resolveMode("pinpoint" as never, "auto", '["pinpoint"]'),
    ).toThrow(/TEST-only/);
    let calls = 0;
    await expect(
      runStateless({
        targets: [
          { source: "pinpoint" as never, tenant: "groupo", company: "Group O" },
        ],
        client: {
          metrics: { requests: 0, payload_bytes: 0 },
          call: async () => {
            calls++;
            return {};
          },
        },
      }),
    ).rejects.toThrow(/TEST-only/);
    expect(calls).toBe(0);
  });
});

const page = (datePosted: string | null, id = "stable-id", title = raw.title) =>
  `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title, identifier: { value: id }, datePosted })}</script>`;
it("preserves original page dates and rejects stale Pinpoint jobs despite feed omission", async () => {
  const result = await validateTargets(
    { targets: [{ source: "pinpoint", tenant: "groupo", company: "Group O" }] },
    {
      now: new Date("2026-11-02T00:00:00Z"),
      get: async (url) => ({
        ok: true,
        status: 200,
        attempts: 1,
        bytes: 100,
        body: url.endsWith("/postings.json")
          ? {
              data: [
                {
                  ...raw,
                  description: "Build reliable data systems. ".repeat(30),
                },
              ],
            }
          : page("2026-06-26T14:45:27+01:00"),
      }),
    },
  );
  expect(result.boards[0]).toMatchObject({
    success: true,
    accepted_count: 0,
    known_recent_posting_count: 0,
    unknown_posting_date_count: 0,
    reason_counts: { posting_too_old: 1 },
  });
});
it("fails missing, invalid or conflicting Pinpoint page identities and dates", () => {
  for (const html of [
    page("yesterday"),
    page(null, "another"),
    page(null, "stable-id", "Another title"),
    page(null) + page(null),
    "<html>no job</html>",
  ])
    expect(() => pinpointDetail(html, "stable-id", raw.title)).toThrow();
  expect(
    pinpointDetail(page(null), "stable-id", raw.title).datePosted,
  ).toBeNull();
});
it("fails Pinpoint detail outages rather than silently losing original dates", async () => {
  await expect(
    loadBoard(
      { source: "pinpoint", tenant: "groupo", company: "Group O" },
      async (url) =>
        url.endsWith("/postings.json")
          ? {
              ok: true,
              status: 200,
              attempts: 1,
              bytes: 100,
              body: { data: [raw] },
            }
          : {
              ok: false,
              status: 503,
              attempts: 1,
              retryable: true,
              error: "HTTP 503",
            },
    ),
  ).rejects.toThrow("HTTP 503");
});
