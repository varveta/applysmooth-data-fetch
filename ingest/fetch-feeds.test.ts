import { describe, expect, it, vi } from "vitest";
import type { SourceId } from "@/lib/jobs-ingest/contract";
import { loadFeedBoard, MAX_FEED_PAGES } from "./lib/fetch-feeds";
import type { FetchResult } from "./lib/http";

const target = (source: SourceId) => ({ source, tenant: "public", company: "Feed Provider" });
const ok = (body: unknown, attempts = 1): FetchResult => ({ ok: true, status: 200, body, attempts, bytes: 100 });
const jobicyJob = (id: number) => ({ id, url: `https://jobicy.com/jobs/${id}`, jobTitle: "Engineer", companyName: "Acme",
  jobDescription: "Build software.", jobGeo: "USA" });
const jobicyPage = (id: number, nextCursor: string | null = null) => ({ jobs: [jobicyJob(id)], jobCount: 1,
  nextCursor, hasMore: nextCursor !== null, success: true, statusCode: 200 });
const himalayasJob = (id: number) => ({ guid: `https://himalayas.app/companies/acme/jobs/${id}`,
  applicationLink: `https://himalayas.app/companies/acme/jobs/${id}?utm_source=api`, title: "Engineer", companyName: "Acme",
  description: "Build software.", locationRestrictions: ["United States"], timezoneRestrictions: [-5], expiryDate: 1795608000 });
const himalayasPage = (ids: number[]) => ({ jobs: ids.map(himalayasJob), totalCount: 10000, offset: 0, limit: 20 });

describe("bounded public feed fetching", () => {
  it("traverses Jobicy cursors sequentially and sums request metrics", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(jobicyPage(1, "opaque+cursor/value"), 2)).mockResolvedValueOnce(ok(jobicyPage(2)));
    const result = await loadFeedBoard(target("jobicy"), get);
    expect(get).toHaveBeenCalledTimes(2);
    const next = new URL(get.mock.calls[1][0]);
    expect(next.origin).toBe("https://jobicy.com");
    expect(next.searchParams.get("cursor")).toBe("opaque+cursor/value");
    expect(next.searchParams.get("geo")).toBe("usa");
    expect(result).toMatchObject({ attempts: 3, bytes: 200, discovery: { pages: 2, capped: false, policy: "observations" } });
    expect((result.body as { jobs: unknown[] }).jobs).toHaveLength(2);
  });
  it("encodes an untrusted cursor instead of fetching it as a URL", async () => {
    const cursor = "https://attacker.example/steal?x=1";
    const get = vi.fn().mockResolvedValueOnce(ok(jobicyPage(1, cursor))).mockResolvedValueOnce(ok(jobicyPage(2)));
    await loadFeedBoard(target("jobicy"), get);
    const next = new URL(get.mock.calls[1][0]);
    expect(next.origin).toBe("https://jobicy.com");
    expect(next.searchParams.get("cursor")).toBe(cursor);
  });
  it("fails a repeated cursor or duplicate identity before exposing a board result", async () => {
    const repeatedCursor = vi.fn().mockResolvedValueOnce(ok(jobicyPage(1, "same"))).mockResolvedValueOnce(ok(jobicyPage(2, "same")));
    await expect(loadFeedBoard(target("jobicy"), repeatedCursor)).rejects.toThrow("Repeated Jobicy cursor");
    const repeatedId = vi.fn().mockResolvedValueOnce(ok(jobicyPage(1, "next"))).mockResolvedValueOnce(ok(jobicyPage(1)));
    await expect(loadFeedBoard(target("jobicy"), repeatedId)).rejects.toThrow("Duplicate jobicy posting");
  });
  it("rejects malformed later pages and propagates rate-limit / network failure", async () => {
    const malformed = vi.fn().mockResolvedValueOnce(ok(jobicyPage(1, "next"))).mockResolvedValueOnce(ok({ jobs: [] }));
    await expect(loadFeedBoard(target("jobicy"), malformed)).rejects.toThrow();
    const failed = vi.fn().mockResolvedValueOnce(ok(jobicyPage(1, "next"))).mockResolvedValueOnce({ ok: false, status: 429,
      error: "HTTP 429", attempts: 4, retryable: true });
    await expect(loadFeedBoard(target("jobicy"), failed)).rejects.toThrow("jobicy feed page 2: HTTP 429");
  });
  it("reports intentional Jobicy discovery cap without treating it as a full snapshot", async () => {
    let page = 0;
    const get = vi.fn(async () => { page++; return ok(jobicyPage(page, `next-${page}`)); });
    const result = await loadFeedBoard(target("jobicy"), get);
    expect(get).toHaveBeenCalledTimes(MAX_FEED_PAGES);
    expect(result.discovery).toEqual({ pages: 10, capped: true, policy: "observations" });
    expect((result.body as { jobs: unknown[] }).jobs).toHaveLength(10);
  });
  it("continues Himalayas short pages until an empty page, not the estimated total", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok({ ...himalayasPage([1]), totalCount: 1 }))
      .mockResolvedValueOnce(ok(himalayasPage([2]))).mockResolvedValueOnce(ok(himalayasPage([])));
    const result = await loadFeedBoard(target("himalayas"), get);
    expect(get).toHaveBeenCalledTimes(3);
    expect(new URL(get.mock.calls[1][0]).searchParams.get("page")).toBe("2");
    expect(new URL(get.mock.calls[2][0]).searchParams.get("country")).toBe("US");
    expect(result.discovery).toMatchObject({ pages: 3, capped: false });
    expect((result.body as { jobs: unknown[] }).jobs).toHaveLength(2);
  });
  it("caps Himalayas search at ten pages and rejects invalid totals", async () => {
    let page = 0;
    const get = vi.fn(async () => ok(himalayasPage([++page])));
    expect((await loadFeedBoard(target("himalayas"), get)).discovery.capped).toBe(true);
    expect(get).toHaveBeenCalledTimes(10);
    await expect(loadFeedBoard(target("himalayas"), vi.fn(async () => ok({ ...himalayasPage([1]), totalCount: -1 })))).rejects.toThrow();
  });
  it("rejects shifting Himalayas pages with repeated job identities", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(himalayasPage([1]))).mockResolvedValueOnce(ok(himalayasPage([1])));
    await expect(loadFeedBoard(target("himalayas"), get)).rejects.toThrow("Duplicate himalayas posting");
  });
  it("requests validated WWR XML as text and preserves the XML body", async () => {
    const xml = '<rss><channel><title>We Work Remotely</title><link>https://weworkremotely.com</link></channel></rss>';
    const get = vi.fn(async () => ok(xml));
    const result = await loadFeedBoard(target("weworkremotely"), get);
    expect(get).toHaveBeenCalledWith("https://weworkremotely.com/remote-jobs.rss", expect.objectContaining({ responseType: "text" }));
    expect(result.body).toBe(xml);
    expect(result.discovery).toEqual({ pages: 1, capped: false, policy: "observations" });
  });
  it("reports quarantined WWR identity conflicts in discovery metrics", async () => {
    const item = '<item><title>Acme: Engineer</title><link>https://weworkremotely.com/remote-jobs/acme</link>' +
      '<guid>https://weworkremotely.com/remote-jobs/acme</guid><description>Headquarters: Texas</description>' +
      '<country>United States</country><expires_at>Wed, 25 Nov 2026 12:00:00 GMT</expires_at></item>';
    const body = '<rss><channel><title>We Work Remotely</title><link>https://weworkremotely.com</link>' +
      item + item.replace("Texas", "Minnesota") + '</channel></rss>';
    const result = await loadFeedBoard(target("weworkremotely"), vi.fn(async () => ok(body)));
    expect(result.discovery).toEqual({ policy: "observations", pages: 1, capped: false, conflictingPostings: 1 });
  });
  it("fetches single-page Remotive and Remote OK feeds once", async () => {
    const remotiveGet = vi.fn(async () => ok({ jobs: [], "job-count": 0 }));
    const remoteokGet = vi.fn(async () => ok([{ legal: "Credit Remote OK", last_updated: 1 }]));
    expect((await loadFeedBoard(target("remotive"), remotiveGet)).discovery.pages).toBe(1);
    expect((await loadFeedBoard(target("remoteok"), remoteokGet)).discovery.pages).toBe(1);
    expect(remotiveGet).toHaveBeenCalledTimes(1);
    expect(remoteokGet).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported sources without making an HTTP request", async () => {
    const get = vi.fn();
    await expect(loadFeedBoard(target("ashby"), get)).rejects.toThrow("Unsupported feed source");
    expect(get).not.toHaveBeenCalled();
  });
});
