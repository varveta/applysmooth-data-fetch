import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as contract from "@/lib/jobs-ingest/contract";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import { publicJobId } from "@/lib/jobs-ingest/catalog";
import { getwork } from "@/lib/jobs-ingest/getwork";
import { publicationChecker, verifyPublicationCandidates } from "./prepublication-verification";
import * as loader from "./load-board";
import { prepareBoard, prepareBoardForPublication, runStateless } from "../stateless";
import { validateTargets } from "../validate-targets";
import { verifyPreview } from "../verify-preview";
import { verifier, type VerificationResult, type VerifyJob } from "../verify";
import { greenhouseFixture } from "../synthetic-fixtures";

const now = new Date("2026-11-02T22:00:00Z");
const target = { source: "getwork" as const, tenant: "public", company: "getwork.dev" };
const empty = { source: target.source, tenant: target.tenant, complete: true, identities: [] };
const key = (id: string) => `getwork:public:${id}`;
const raw = (id: string, title = id) => ({
  id, title, company: { name: "Example", slug: "example" },
  getwork_url: `https://getwork.dev/jobs/${id}/`, url: `https://careers.example.com/jobs/${id}`,
  apply_url: `https://careers.example.com/jobs/${id}`, published_at: "2026-10-29T09:00:00Z",
  first_seen_at: "2026-11-01T12:00:00Z", last_seen_at: "2026-11-02T12:00:00Z",
  location: "Boston, MA", countries: ["US"], remote: "hybrid", employment_type: "full-time", active: true,
  untrusted_description: "Build reliable distributed software. ".repeat(20) + "Original final requirement.",
});
const result = (job: VerifyJob, status: VerificationResult["status"] = "open", detail = "Source and apply link confirmed"): VerificationResult =>
  ({ id: job.id, stage: "verify_link", status, http_status: status === "open" ? 200 : 403, detail });
function fakeChecker(statuses: Record<string, VerificationResult["status"]> = {}) {
  const metrics = { requests: 0 };
  const check = vi.fn(async (job: VerifyJob) => { metrics.requests += 2; return result(job, statuses[job.source_job_id]); });
  return { check, metrics };
}
const ok = (body: unknown) => ({ ok: true as const, body, status: 200, attempts: 1, bytes: 100 });
function mockLoader(jobs: unknown[]) {
  vi.spyOn(loader, "loadBoard").mockImplementation(async (_target, get) => {
    await get!("https://source.example.com/feed");
    return { body: jobs, attempts: 1, bytes: 100,
      discovery: { policy: "observations" as const, pages: 1, capped: true, maximum_jobs: 20 } };
  });
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected test network"); })));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps pure preparation offline and quarantines actual non-open checks only in online admission", async () => {
  const jobs = [raw("good-one"), raw("blocked-two"), raw("redirect-three")];
  expect(prepareBoard(target, jobs, now, empty).rows).toHaveLength(3);
  expect(fetch).not.toHaveBeenCalled();
  const checker = fakeChecker({ "blocked-two": "uncertain", "redirect-three": "uncertain" });
  const prepared = await prepareBoardForPublication(target, jobs, now, empty, publicationChecker(checker));
  expect(prepared).toMatchObject({ fetched_count: 3, gates: { accepted: 1, quarantined: 2 },
    quarantined_count: 2, identity_resolution: { splits: 0, merges: 0, quarantined: 0 },
    prepublication: { checked_count: 3, open_count: 1, quarantined_count: 2, requests: 6, all_candidates_verified: false } });
  expect(prepared.quarantined_posting_ids).toEqual([key("blocked-two"), key("redirect-three")]);
  expect(prepared.rows.map(row => row.source_job_id)).toEqual(["good-one"]);
});

it("preserves a historical anchor and original dates when its verified alias survives", async () => {
  const original = raw("original-one", "Engineer"), sibling = raw("sibling-two", "Engineer");
  const firstSeen = "2026-10-20T00:00:00Z";
  const anchor = { id: publicJobId(key(original.id)), source_job_id: original.id, first_seen_at: firstSeen,
    duplicate_posting_ids: [key(sibling.id), key("absent-three")] };
  const checker = publicationChecker(fakeChecker({ [original.id]: "uncertain" }));
  const prepared = await prepareBoardForPublication(target, [original, sibling], now, { ...empty, identities: [anchor] }, checker);
  expect(prepared.rows).toHaveLength(1);
  expect(prepared.rows[0]).toMatchObject({ id: anchor.id, source_job_id: original.id,
    observed_source_job_id: sibling.id, first_seen_at: firstSeen, posted_at: "2026-10-29T09:00:00.000Z",
    apply_url: sibling.apply_url, source_url: sibling.getwork_url,
    duplicate_posting_ids: [key("absent-three"), key(sibling.id)] });
  expect(prepared).toMatchObject({ fetched_count: 2, quarantined_count: 1 });
  expect(prepared.quarantined_posting_ids).toEqual([key(original.id)]);
});

it("retains valid duplicate identities without merging unverified candidate content", async () => {
  const normalize = ADAPTERS.getwork.normalize;
  vi.spyOn(ADAPTERS.getwork, "normalize").mockImplementation((item, tenant, company) => {
    const job = normalize(item, tenant, company);
    return { ...job, requisitionKey: "same-employer-requisition",
      locations: job.sourceJobId === "blocked-one" ? [{ raw: "Unverified location", country: "US",
        city: "Unverified city", region: null, remote: false }] : job.locations };
  });
  const jobs = [raw("blocked-one", "Engineer"), raw("good-two", "Engineer")];
  const prepared = await prepareBoardForPublication(target, jobs, now, empty,
    publicationChecker(fakeChecker({ "blocked-one": "uncertain" })));
  expect(prepared.rows).toHaveLength(1);
  expect(prepared.rows[0].duplicate_posting_ids).toEqual([key("blocked-one")]);
  expect(prepared.rows[0].locations.some(location => location.city === "Unverified city")).toBe(false);
  expect(prepared.rows[0].description).toBe(jobs[1].untrusted_description);
  expect(prepared).toMatchObject({ gates: { quarantined: 1, accepted: 1 }, fetched_count: 2 });
});

it("keeps malformed identity/history failures fatal before any verification", async () => {
  const checker = fakeChecker();
  await expect(prepareBoardForPublication(target, [{ ...raw("good-one"), getwork_url: "https://evil.example/job" }], now, empty, checker)).rejects.toThrow();
  await expect(prepareBoardForPublication(target, [raw("good-one")], now, { ...empty, complete: false }, checker)).rejects.toThrow();
  expect(checker.check).not.toHaveBeenCalled();
});

it("does not check quality-rejected jobs or change the twelve existing sources", async () => {
  const checker = fakeChecker();
  const prepared = await prepareBoardForPublication(target, [{ ...raw("short-one"), untrusted_description: "short" }], now, empty, checker);
  expect(prepared).toMatchObject({ fetched_count: 1, gates: { rejected: 1 }, prepublication: { checked_count: 0 } });
  for (const source of contract.SOURCE_IDS.filter(source => !contract.isExperimentalSource(source)))
    expect(await verifyPublicationCandidates(source, [], now, checker)).toBeUndefined();
  const legacyTarget = { source: "greenhouse" as const, tenant: "example", company: "Example" };
  const snapshot = { ...empty, source: legacyTarget.source, tenant: legacyTarget.tenant };
  const offline = prepareBoard(legacyTarget, { jobs: [greenhouseFixture] }, now, snapshot);
  const online = await prepareBoardForPublication(legacyTarget, { jobs: [greenhouseFixture] }, now, snapshot, checker);
  expect(online).toEqual({ ...offline, prepublication: undefined });
  expect(checker.check).not.toHaveBeenCalled();
});

it("bounds verification and fails a broken checker without admitting healthy partial results", async () => {
  const checker = fakeChecker();
  const job = getwork.normalize(raw("good-one"), "public");
  await expect(verifyPublicationCandidates("getwork", Array(51).fill(job), now, checker)).rejects.toThrow("budget");
  expect(checker.check).not.toHaveBeenCalled();
  checker.check.mockImplementation(async () => { checker.metrics.requests++; throw new Error("checker failed"); });
  await expect(prepareBoardForPublication(target, [raw("good-one")], now, empty, checker)).rejects.toThrow("did not complete");
});

it("caches only exact identities and application URLs within one invocation, including failures", async () => {
  const delegate = fakeChecker({ "blocked-one": "uncertain" }), checker = publicationChecker(delegate);
  const job: VerifyJob = { id: key("blocked-one"), source: "getwork", tenant: "public",
    source_job_id: "blocked-one", apply_url: raw("blocked-one").apply_url, reason: "prepublication" };
  await Promise.all([checker.check(job), checker.check(job)]);
  expect(await checker.check({ ...job, id: "historical-catalog-id", reason: "preview" }))
    .toMatchObject({ id: "historical-catalog-id", status: "uncertain" });
  expect(delegate.check).toHaveBeenCalledTimes(1);
  await checker.check({ ...job, apply_url: job.apply_url + "?changed=1" });
  await checker.check({ ...job, source_job_id: "different-one" });
  await publicationChecker(delegate).check(job);
  expect(delegate.check).toHaveBeenCalledTimes(4);
});

it("does not conceal wrong-identity verification responses behind the cache", async () => {
  const delegate = fakeChecker();
  delegate.check.mockImplementation(async job => ({ ...result(job), id: "wrong" }));
  await expect(prepareBoardForPublication(target, [raw("good-one")], now, empty, publicationChecker(delegate)))
    .rejects.toThrow("did not complete");
});

it("refuses source-only confirmation as application verification", async () => {
  const checker = fakeChecker();
  checker.check.mockImplementation(async job => ({ ...result(job), stage: "verify_source" }));
  await expect(prepareBoardForPublication(target, [raw("good-one")], now, empty, checker))
    .rejects.toThrow("did not complete");
});

it("reports application quarantines separately from deduplication and keeps request counts", async () => {
  const jobs = [raw("good-one"), raw("blocked-two"), raw("redirect-three")];
  mockLoader(jobs);
  const accepted = vi.fn();
  const report = await validateTargets({ targets: [target] }, { now, get: async () => ok(jobs), onAccepted: accepted,
    checker: fakeChecker({ "blocked-two": "uncertain", "redirect-three": "uncertain" }) });
  expect(report.boards[0]).toMatchObject({ success: true, fetched_count: 3, quality_accepted_count: 3,
    accepted_count: 1, quarantined_count: 2, rejected_count: 0, deduplicated_count: 0,
    requests: 1, verification_requests: 6, accepted_posted_within_15_days_count: 1,
    prepublication: { outcomes: { open: 1, uncertain: 2 }, all_candidates_verified: false } });
  expect(accepted.mock.calls[0][0]).toHaveLength(1);
});

it("counts verified duplicates separately from verification quarantines", async () => {
  const jobs = [raw("good-one", "Engineer"), raw("good-two", "Engineer"), raw("blocked-three", "Other role")];
  mockLoader(jobs);
  const report = await validateTargets({ targets: [target] }, { now, get: async () => ok(jobs),
    checker: fakeChecker({ "blocked-three": "uncertain" }) });
  expect(report.boards[0]).toMatchObject({ quality_accepted_count: 3, accepted_count: 1,
    deduplicated_count: 1, rejected_count: 1, quarantined_count: 1,
    prepublication: { candidate_count: 3, checked_count: 3, open_count: 2, quarantined_count: 1 } });
});

it("preserves actual safe-checker 403 and generic-redirect reasons without retrying during preview", async () => {
  const jobs = [raw("good-one"), raw("blocked-two"), raw("redirect-three")];
  mockLoader(jobs);
  const network = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith("https://getwork.dev/api/jobs/")) {
      const job = jobs.find(job => url.endsWith(`/${job.id}/`));
      return new Response(JSON.stringify(job), { status: 200 });
    }
    if (url.endsWith("/blocked-two")) return new Response("", { status: 403 });
    if (url.endsWith("/redirect-three")) return new Response(null, { status: 302, headers: { location: "/careers" } });
    if (url.endsWith("/good-one")) return new Response("", { status: 200 });
    throw new Error("Unexpected test request");
  });
  vi.stubGlobal("fetch", network);
  const report = await verifyPreview({ targets: [target] }, { source: "getwork",
    checker: verifier({ allowExperimental: true }),
    validate: (manifest, options) => validateTargets(manifest, { ...options, now, get: async () => ok(jobs) }) });
  expect(report).toMatchObject({ success: true, production_ready: false, writes: 0, verification_requests: 6,
    boards: [{ accepted: 1, checked: 1, outcomes: { open: 1 } }] });
  expect(report.validation.boards[0].prepublication).toMatchObject({ checked_count: 3, quarantined_count: 2,
    all_candidates_verified: false, reason_counts: {
      "verify_link: uncertain: Apply link HTTP 403": 1,
      "verify_link: uncertain: Apply redirect points to generic careers or login page": 1,
    } });
  expect(network).toHaveBeenCalledTimes(6);
  expect(network.mock.calls.some(([url]) => String(url).endsWith("/careers"))).toBe(false);
});

it("does not call an all-quarantined preview successful or lose fetched identities", async () => {
  const jobs = [raw("blocked-one"), raw("closed-two")];
  mockLoader(jobs);
  const checker = { ...verifier(), ...fakeChecker({ "blocked-one": "uncertain", "closed-two": "closed" }) };
  const report = await verifyPreview({ targets: [target] }, { source: "getwork", checker,
    validate: (manifest, options) => validateTargets(manifest, { ...options, now, get: async () => ok(jobs) }) });
  expect(report).toMatchObject({ success: false, boards: [{ accepted: 0, checked: 0, unverified: true }] });
  expect(report.validation.boards[0]).toMatchObject({ fetched_count: 2, accepted_count: 0, quarantined_count: 2, deduplicated_count: 0 });
  expect(checker.check).toHaveBeenCalledTimes(2);
});

it("uses the shared policy before live batching and completes with every fetched/quarantined identity", async () => {
  // Simulate future approved activation; production guards are not changed by this task.
  const experimental = contract.isExperimentalSource;
  vi.spyOn(contract, "isExperimentalSource").mockImplementation(source => source !== "getwork" && experimental(source));
  const jobs = [raw("good-one"), raw("blocked-two")];
  mockLoader(jobs);
  const calls: Record<string, any>[] = [];
  const client = { metrics: { requests: 0, payload_bytes: 0 }, call: vi.fn(async (value: unknown) => {
    const body = value as Record<string, any>; calls.push(body); client.metrics.requests++;
    if (body.operation === "board_identities") return empty;
    if (body.operation === "publish_batch") return { accepted: body.rows.length,
      results: body.rows.map((row: { id: string }) => ({ id: row.id, outcome: "inserted" })) };
    return { complete: true, missing: 0, withdrawn: 0, marked_uncertain: 0, guard: "partial_snapshot" };
  }) };
  const summary = await runStateless({ targets: [target], client, now, get: async () => ok(jobs),
    checker: fakeChecker({ "blocked-two": "uncertain" }), log: () => {} });
  expect(calls.map(call => call.operation)).toEqual(["board_identities", "publish_batch", "complete_board"]);
  expect(calls[1].rows.map((row: { source_job_id: string }) => row.source_job_id)).toEqual(["good-one"]);
  expect(calls[2]).toMatchObject({ fetched_count: 2, accepted_count: 1, quarantined_count: 1,
    quarantined_posting_ids: [key("blocked-two")], batches_expected: 1 });
  expect(summary).toMatchObject({ fetch_requests: 1, verification_requests: 4, collector_requests: 3, requests: 8 });
});
