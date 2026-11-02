import { expect, it, vi } from "vitest";
import { trakstar } from "./trakstar";
import { loadTrakstarBoard } from "../../../ingest/lib/fetch-trakstar";
import {
  parseTemplateJson,
  trakstarDetail,
} from "../../../ingest/lib/trakstar-detail";
import { validateTargets } from "../../../ingest/validate-targets";
import { resolveMode } from "../../../ingest/source-pipeline";
const raw = {
  id: "job1",
  client_name: "example",
  title: "Data Engineer",
  description: "<p>" + "Build data infrastructure. ".repeat(30) + "</p>",
  hosted_url: "https://example.hire.trakstar.com/jobs/job1/",
  location: { city: "Austin", state: "Texas", country: "United States" },
  allows_remote: false,
  position_type: "full_time",
  close_date: null,
};
const page = (
  objects: unknown[],
  total = objects.length,
  offset = 0,
  limit = 20,
) => ({ objects, meta: { total, offset, limit } });
const ok = (body: unknown) => ({
  ok: true as const,
  status: 200,
  body,
  bytes: 100,
  attempts: 1,
});
const html = (id = "job1", extra = {}) =>
  `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: raw.title, identifier: { value: id }, datePosted: "2026-11-01", ...extra })}</script>`;
it("preserves source posting dates and entire descriptions", () => {
  const j = trakstar.normalize(
    { ...raw, detail_posted_at: "2026-11-01" },
    "example",
    "Example",
  );
  expect(j).toMatchObject({
    sourceJobId: "job1",
    company: "Example",
    postedAt: "2026-11-01T00:00:00.000Z",
    usEligibility: "us",
  });
  expect(j.descriptionText).toContain("Build data infrastructure.");
  expect(trakstar.normalize(raw, "example", "Example").postedAt).toBeNull();
  expect(() =>
    trakstar.normalize({ ...raw, client_name: "other" }, "example", "Example"),
  ).toThrow();
  expect(() =>
    trakstar.normalize(
      { ...raw, hosted_url: "https://evil.example/jobs/job1/" },
      "example",
      "Example",
    ),
  ).toThrow();
});
it("loads complete pages and matches posting identity on date-bearing job pages", async () => {
  const get = vi.fn(async (url: string) =>
    ok(url.includes("jsapi.") ? page([raw]) : html()),
  );
  const r = await loadTrakstarBoard({ tenant: "example" }, get);
  expect(r.body[0].detail_posted_at).toBe("2026-11-01");
  expect(r.attempts).toBe(2);
});
it("handles both documented and live total fields but rejects conflicting totals", async () => {
  const r = await loadTrakstarBoard({ tenant: "example" }, async (url) =>
    ok(
      url.includes("jsapi.")
        ? { objects: [raw], meta: { total_count: 1, limit: 20, offset: 0 } }
        : html(),
    ),
  );
  expect(r.body).toHaveLength(1);
  await expect(
    loadTrakstarBoard({ tenant: "example" }, async () =>
      ok({
        objects: [raw],
        meta: { total: 1, total_count: 2, limit: 20, offset: 0 },
      }),
    ),
  ).rejects.toThrow();
});
it("handles multipage feeds and fails partial, repeated, changed and wrong-tenant snapshots", async () => {
  const raw2 = {
    ...raw,
    id: "job2",
    hosted_url: raw.hosted_url.replace("job1", "job2"),
  };
  const get = async (url: string) =>
    ok(
      url.includes("jsapi.")
        ? new URL(url).searchParams.get("offset") === "0"
          ? page([raw], 2, 0, 1)
          : page([raw2], 2, 1, 1)
        : html(url.includes("job2") ? "job2" : "job1"),
    );
  expect(
    (await loadTrakstarBoard({ tenant: "example" }, get)).body,
  ).toHaveLength(2);
  for (const body of [
    page([raw], 2),
    page([raw, raw], 2),
    page([{ ...raw, client_name: "other" }]),
    page([], 501),
  ])
    await expect(
      loadTrakstarBoard({ tenant: "example" }, async () => ok(body)),
    ).rejects.toThrow();
  for (const second of [page([raw2], 3, 1, 1), page([raw2], 2, 0, 1)]) {
    let n = 0;
    await expect(
      loadTrakstarBoard({ tenant: "example" }, async () =>
        ok(++n === 1 ? page([raw], 2, 0, 1) : second),
      ),
    ).rejects.toThrow();
  }
});
it("rejects failed details, mismatching identities and invalid dates", async () => {
  for (const body of [
    html("wrong"),
    html("job1", { datePosted: "yesterday" }),
    "<html>Error</html>",
  ])
    await expect(
      loadTrakstarBoard({ tenant: "example" }, async (url) =>
        ok(url.includes("jsapi.") ? page([raw]) : body),
      ),
    ).rejects.toThrow();
  await expect(
    loadTrakstarBoard({ tenant: "example" }, async (url) =>
      url.includes("jsapi.")
        ? ok(page([raw]))
        : {
            ok: false,
            status: 429,
            error: "HTTP 429",
            attempts: 1,
            retryable: true,
          },
    ),
  ).rejects.toThrow();
  expect(() => trakstarDetail(html() + html(), "job1", raw.title)).toThrow();
});
it("escapes literal JSON string control characters without evaluating or accepting invalid syntax", () => {
  expect(
    parseTemplateJson('{"description":"one\ntwo","quoted":"\\\"x\\\""}'),
  ).toEqual({ description: "one\ntwo", quoted: '"x"' });
  expect(() => parseTemplateJson("{x: process.exit()}")).toThrow();
});
it("reports stale/expired rows using original dates and blocks live activation", async () => {
  const result = await validateTargets(
    {
      targets: [{ source: "trakstar", tenant: "example", company: "Example" }],
    },
    {
      now: new Date("2026-11-02T00:00:00Z"),
      get: async (url) =>
        ok(
          url.includes("jsapi.")
            ? page([raw])
            : html("job1", {
                datePosted: "2025-01-01",
                validThrough: "2025-02-01",
              }),
        ),
    },
  );
  expect(result.boards[0]).toMatchObject({
    accepted_count: 0,
    rejected_count: 1,
    reason_counts: { posting_too_old: 1, closed_at_source: 1 },
  });
  expect(() => resolveMode("trakstar", "publish", '["trakstar"]')).toThrow(
    /TEST-only/,
  );
});
