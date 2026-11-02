import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { UnverifiedPostingError } from "@/lib/jobs-ingest/normalization-error";
import * as validator from "./validate-targets";
import { ashbyFixture } from "./synthetic-fixtures";
import type { FetchResult } from "./lib/http";

const now = new Date("2026-10-30T12:00:00Z");
const target = { source: "ashby", tenant: "example", company: "Example" };
const ok = (jobs: unknown[]): FetchResult => ({ ok: true, status: 200, body: { jobs }, bytes: 500, attempts: 1 });
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

it("counts unverified identities as quarantined while retaining healthy peers", async () => {
  const normalize = ADAPTERS.ashby.normalize;
  vi.spyOn(ADAPTERS.ashby, "normalize").mockImplementation((raw, tenant, company) => {
    if (ADAPTERS.ashby.postingId(raw) === "unverified") throw new UnverifiedPostingError("Unavailable original");
    return normalize(raw, tenant, company);
  });
  const accepted: unknown[] = [];
  const report = await validator.validateTargets({ targets: [target] }, {
    now, get: async () => ok([ashbyFixture, { ...ashbyFixture, id: "unverified" }]),
    onAccepted: rows => accepted.push(...rows),
  });
  expect(report).toMatchObject({ success: true, writes: 0 });
  expect(report.boards[0]).toMatchObject({ fetched_count: 2, accepted_count: 1,
    quarantined_count: 1, rejected_count: 0, reason_counts: { normalize_failed: 1 },
    unknown_posting_date_count: 0, quality_accepted_count: 1, deduplicated_count: 0 });
  expect(accepted).toHaveLength(1);
});

it("does not treat an unexpected normalization error as an unverified posting", async () => {
  vi.spyOn(ADAPTERS.ashby, "normalize").mockImplementation(() => { throw new Error("Identity mismatch"); });
  const accepted = vi.fn();
  const report = await validator.validateTargets({ targets: [target] }, {
    now, get: async () => ok([ashbyFixture]), onAccepted: accepted,
  });
  expect(report.success).toBe(false);
  expect(accepted).not.toHaveBeenCalled();
});

it("reports actual quality gates without storing jobs or using collector credentials", async () => {
  const report = await validator.validateTargets({ targets: [target] }, { now, get: async () => ok([
    ashbyFixture,
    { ...ashbyFixture, id: "canada", location: "Toronto, Canada", address: { postalAddress: { addressCountry: "CA" } } },
    { ...ashbyFixture, id: "unknown", location: "Remote", address: undefined },
  ]) });
  expect(report).toMatchObject({ success: true, writes: 0, identity_basis: "empty_snapshot", live_ingestion_verified: false });
  expect(report.boards).toHaveLength(1);
  expect(report.boards[0]).toMatchObject({ board: "ashby:example", success: true, fetched_count: 3,
    accepted_count: 1, rejected_count: 1, quarantined_count: 1, requests: 1, bytes: 500, writes: 0,
    reason_counts: { not_us: 1, us_eligibility_unknown: 1 } });
  expect(JSON.stringify(report)).not.toContain(ashbyFixture.descriptionPlain);
});

it("preserves successful peers and counts requests on failed boards", async () => {
  const report = await validator.validateTargets({ targets: [target, { ...target, tenant: "broken" }] }, {
    now, get: async (url) => url.includes("broken")
      ? { ok: false, status: 429, error: "HTTP 429", attempts: 4, retryable: true } : ok([ashbyFixture]),
  });
  expect(report.success).toBe(false);
  expect(report.boards[0]).toMatchObject({ success: true, accepted_count: 1 });
  expect(report.boards[1]).toMatchObject({ success: false, error: "HTTP 429", fetched_count: null,
    accepted_count: null, requests: 4, writes: 0 });
});

it("validates every target before starting network work", async () => {
  let calls = 0;
  const get = async () => { calls++; return ok([]); };
  await expect(validator.validateTargets({ targets: [target, target] }, { get })).rejects.toThrow("Duplicate");
  await expect(validator.validateTargets({ targets: [{ ...target, source: "unsupported" }] }, { get })).rejects.toThrow();
  await expect(validator.validateTargets({ targets: [{ ...target, tenant: "../../outside" }] }, { get })).rejects.toThrow();
  expect(calls).toBe(0);
});

it("counts deduplication using publication preparation, not raw feed count", async () => {
  const report = await validator.validateTargets({ targets: [target] }, { now, get: async () => ok([
    ashbyFixture, { ...ashbyFixture, id: "duplicate", jobUrl: "https://jobs.ashbyhq.com/example/duplicate" },
  ]) });
  expect(report.boards[0]).toMatchObject({ fetched_count: 2, accepted_count: 1, rejected_count: 1,
    quarantined_count: 0, quality_accepted_count: 2, deduplicated_count: 1 });
});

it("writes the report and returns failure exit status when a board fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "validate-targets-")); dirs.push(dir);
  const manifest = join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ targets: [target] }));
  const result = await validator.runValidation(manifest, { outputDirectory: dir, now,
    get: async () => ({ ok: false, status: 404, error: "HTTP 404", attempts: 1, retryable: false }),
  });
  expect(result.exitCode).toBe(1);
  const saved = JSON.parse(readFileSync(result.reportPath, "utf8"));
  expect(saved).toMatchObject({ success: false, writes: 0, live_ingestion_verified: false });
  expect(saved.boards[0].error).toBe("HTTP 404");
});

it("restricts validation to one manifest source and names its artifact independently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "validate-targets-")); dirs.push(dir);
  const manifest = join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ targets: [target,
    { source: "remoteok", tenant: "public", company: "Remote OK" }] }));
  const result = await validator.runValidation(manifest, { outputDirectory: dir, now, source: "ashby",
    get: async () => ok([ashbyFixture]),
  });
  expect(result.exitCode).toBe(0);
  expect(result.report.boards).toHaveLength(1);
  expect(result.report.boards[0].board).toBe("ashby:example");
  expect(result.reportPath).toBe(join(dir, "source-validation-test-ashby.json"));
});

it("rejects unsupported or absent source filters before fetching", async () => {
  let calls = 0;
  const get = async () => { calls++; return ok([]); };
  for (const source of ["../outside", "greenhouse"])
    await expect(validator.validateTargets({ targets: [target] }, { source, get })).rejects.toThrow();
  expect(calls).toBe(0);
});


it("separates the 15-day original-date window from acceptance and the 60-day gate", async () => {
  const dates = [
    new Date(now.getTime() - 15 * 86_400_000).toISOString(),
    new Date(now.getTime() - 15 * 86_400_000 - 1).toISOString(),
    now.toISOString(),
    new Date(now.getTime() + 60_000).toISOString(),
    undefined,
    new Date(now.getTime() - 61 * 86_400_000).toISOString(),
  ];
  const jobs = dates.map((publishedAt, i) => ({ ...ashbyFixture, id: `age-${i}`,
    title: `Distinct Engineer ${i}`, jobUrl: `https://jobs.ashbyhq.com/example/age-${i}`, publishedAt }));
  const report = await validator.validateTargets({ targets: [target] }, { now, get: async () => ok(jobs) });
  expect(report).toMatchObject({ fresh_posting_window_days: 15 });
  expect(report.boards[0]).toMatchObject({ success: true, fetched_count: 6,
    accepted_count: 5, known_recent_posting_count: 4, unknown_posting_date_count: 1,
    posted_within_15_days_count: 2, accepted_posted_within_15_days_count: 2 });
});
