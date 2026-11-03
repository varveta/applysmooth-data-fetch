import { expect, it, vi } from "vitest";
import { remotebackendjobs, RemoteBackendPosting } from "./remote-backend-jobs";
import { loadRemoteBackendJobsBoard } from "../../../ingest/lib/fetch-remote-backend-jobs";
import { evaluateGates } from "./gates";

const raw = {
  id: "test-job-1", title: "Platform Engineer", location: "Remote (United States)",
  link: "https://jobs.example.com/engineer?id=1", isoDate: "2026-10-29T00:00:00.000Z",
  createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z",
  company: { name: "Example", incidental: "omit" },
  content: `<p>${"Build reliable infrastructure. ".repeat(30)}</p><p>Final requirement preserved.</p>`,
  contentSnippet: "A shortened teaser.", archivedAt: null, reviewPending: false,
  paymentIntentId: "must-not-retain", posterId: "must-not-retain",
};
const ok = (body: unknown) => ({ ok: true as const, status: 200, body, attempts: 1, bytes: 100 });
const wait = async () => {};
it("preserves full content, original date, employer apply link and required provider credit", () => {
  const job = remotebackendjobs.normalize(raw, "public");
  expect(job).toMatchObject({ source: "remotebackendjobs", company: "Example", sourceJobId: raw.id,
    postedAt: raw.isoDate, usEligibility: "us", applyUrl: raw.link,
    sourceUrl: `https://www.remotebackendjobs.com/${raw.id}` });
  expect(job.descriptionText).toContain("Final requirement preserved.");
  expect(job.descriptionText).not.toContain("shortened teaser");
  expect(remotebackendjobs.attribution("public", job)).toEqual({ name: "Remote Backend Jobs", url: job.sourceUrl });
  expect(remotebackendjobs.normalize({ ...raw, isoDate: null }, "public").postedAt).toBeNull();
  expect(() => remotebackendjobs.attribution("public")).toThrow(/per-job/);
  expect(() => remotebackendjobs.normalize(raw, "backend")).toThrow();
});
it("strips incidental data and never infers US eligibility from a North America filter", () => {
  const parsed = RemoteBackendPosting.parse(raw);
  expect(parsed).not.toHaveProperty("paymentIntentId");
  expect(parsed).not.toHaveProperty("posterId");
  expect(parsed.company).toEqual({ name: "Example" });
  expect(remotebackendjobs.normalize({ ...raw, location: "Remote - North America", geoRegions: ",north-america," }, "public").usEligibility).toBe("unknown");
  expect(remotebackendjobs.normalize({ ...raw, location: "Remote - Canada" }, "public").usEligibility).toBe("not_us");
});
it("rejects unsafe links, snippets-only details and unreviewed postings", () => {
  for (const replacement of [{ link: "http://jobs.example.com/1" }, { link: "https://127.0.0.1/1" }, { content: undefined }, { reviewPending: true }])
    expect(() => remotebackendjobs.normalize({ ...raw, ...replacement }, "public")).toThrow();
  const closed = remotebackendjobs.normalize({ ...raw, archivedAt: "2026-10-31T00:00:00.000Z" }, "public");
  expect(evaluateGates(closed, { now: new Date("2026-11-02"), open: true, lastSeenAt: "2026-11-02T00:00:00Z", duplicateOf: null }).reasons).toContain("closed_at_source");
});
it("rejects employer credentials, explicit ports and nonpublic hostnames before retaining details", () => {
  for (const link of [
    "https://user:secret@jobs.example.com/1", "https://jobs.example.com:8443/1",
    "https://jobs.example.com:443/1", "https://[::1]/1", "https://2130706433/1",
    "https://jobs.local/1", "https://jobs.localhost/1", "https://jobs.internal/1",
  ]) expect(() => RemoteBackendPosting.parse({ ...raw, link })).toThrow("Unsafe employer application URL");
  expect(RemoteBackendPosting.parse(raw).link).toBe(raw.link);
});
it("loads bounded pages and full details with a serial request budget", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ ...raw, id: `test-${i}`, title: `Engineer ${i}` }));
  const pause = vi.fn(wait), urls: string[] = [];
  const result = await loadRemoteBackendJobsBoard({ tenant: "public" }, async (url, options) => {
    expect(options?.redirect).toBe("error");
    urls.push(url);
    if (url.includes("?")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return ok(rows.slice(offset, offset + 50));
    }
    return ok(rows.find(j => url.endsWith(`/${j.id}`)));
  }, { wait: pause, maxJobs: 250 });
  expect(result.body).toHaveLength(51);
  expect(result.discovery).toMatchObject({ policy: "observations", pages: 53, capped: false });
  expect(result.attempts).toBe(53);
  expect(pause).toHaveBeenCalledTimes(53);
  expect(pause).toHaveBeenCalledWith(600);
  expect(urls[1]).toContain("offset=50");
  expect(JSON.stringify(result.body)).not.toContain("must-not-retain");
});
it("defaults to one capped observation page when offset windows can overlap", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ ...raw, id: `default-${i}` }));
  const get = vi.fn(async (url: string) => {
    if (url.includes("?")) {
      expect(new URL(url).searchParams.get("offset")).toBe("0");
      expect(new URL(url).searchParams.get("limit")).toBe("50");
      return ok(rows);
    }
    return ok(rows.find(job => url.endsWith(`/${job.id}`)));
  });
  const result = await loadRemoteBackendJobsBoard({ tenant: "public" }, get, { wait });
  expect(result.body).toHaveLength(50);
  expect(result.discovery).toMatchObject({ policy: "observations", pages: 51, capped: true, maximum_jobs: 50 });
  expect(get).toHaveBeenCalledTimes(51);
});
it("marks a bounded window as capped and never pretends an empty window proves closure", async () => {
  const result = await loadRemoteBackendJobsBoard({ tenant: "public" }, async url => ok(url.includes("?") ? [raw] : raw), { maxJobs: 1, wait });
  expect(result.discovery).toMatchObject({ policy: "observations", capped: true, maximum_jobs: 1 });
  const empty = await loadRemoteBackendJobsBoard({ tenant: "public" }, async () => ok([]), { wait });
  expect(empty.body).toEqual([]);
  expect(empty.discovery.policy).toBe("observations");
});
it("fails duplicate pages, changed details, incomplete content and provider errors", async () => {
  await expect(loadRemoteBackendJobsBoard({ tenant: "public" }, async () => ok([raw, raw]), { wait })).rejects.toThrow(/repeated/);
  const firstPage = Array.from({ length: 50 }, (_, i) => ({ ...raw, id: `overlap-${i}` }));
  await expect(loadRemoteBackendJobsBoard({ tenant: "public" }, async url =>
    ok(new URL(url).searchParams.get("offset") === "0" ? firstPage : [firstPage[49]]),
  { wait, maxJobs: 51 })).rejects.toThrow("Remote Backend Jobs repeated pagination identity");
  for (const replacement of [{ id: "different" }, { link: "https://jobs.example.com/different" }, { isoDate: null }, { content: undefined }]) {
    await expect(loadRemoteBackendJobsBoard({ tenant: "public" }, async url => ok(url.includes("?") ? [raw] : { ...raw, ...replacement }), { wait })).rejects.toThrow();
  }
  await expect(loadRemoteBackendJobsBoard({ tenant: "public" }, async () => ({ ok: false, status: 429, error: "HTTP 429", attempts: 2, retryable: true }), { wait })).rejects.toThrow("HTTP 429");
});
