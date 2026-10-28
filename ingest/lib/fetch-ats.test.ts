import { describe, expect, it, vi } from "vitest";
import { loadAtsBoard } from "./fetch-ats";
import type { FetchResult, getJson } from "./http";

const target = { source: "smartrecruiters" as const, tenant: "example", company: "Example" };
const detail = (id: string) => ({
  id, name: "Engineer", company: { name: "Example", identifier: "Example" },
  location: { city: "Austin", country: "us" }, releasedDate: "2026-10-20T12:00:00Z",
  postingUrl: `https://jobs.smartrecruiters.com/example/${id}`, applyUrl: `https://jobs.smartrecruiters.com/example/${id}?oga=true`,
  active: true, visibility: "PUBLIC", jobAd: { sections: { jobDescription: { text: "Build safe software." } } },
});
const ok = (body: unknown): FetchResult => ({ ok: true, status: 200, body, attempts: 1, bytes: 10 });
const page = (total: number, offset = 0) => ({
  offset, limit: 100, totalFound: total,
  content: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, i) => ({
    id: String(offset + i + 1), ref: `https://untrusted.example/${i}`,
  })),
});
const failure: FetchResult = { ok: false, status: 503, error: "Service unavailable", attempts: 4, retryable: true };

describe("complete ATS fetch snapshots", () => {
  it("loads every page and canonical detail with bounded per-host concurrency", async () => {
    let active = 0;
    let highest = 0;
    const get = vi.fn<typeof getJson>(async (url) => {
      const u = new URL(url);
      expect(u.hostname).toBe("api.smartrecruiters.com");
      if (u.searchParams.has("offset")) {
        expect(u.searchParams.get("destination")).toBe("PUBLIC");
        return ok(page(103, Number(u.searchParams.get("offset"))));
      }
      active++;
      highest = Math.max(highest, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return ok(detail(u.pathname.split("/").at(-1)!));
    });
    const loaded = await loadAtsBoard(target, get);
    expect((loaded.body as { jobs: unknown[] }).jobs).toHaveLength(103);
    expect(loaded).toMatchObject({ attempts: 105, bytes: 1050 });
    expect(get).toHaveBeenCalledTimes(105);
    expect(highest).toBeGreaterThan(1);
    expect(highest).toBeLessThanOrEqual(4);
    expect(get.mock.calls.some(([url]) => url.includes("untrusted.example"))).toBe(false);
  });
  it("handles a genuinely empty complete board without detail requests", async () => {
    const get = vi.fn<typeof getJson>().mockResolvedValue(ok(page(0)));
    expect(await loadAtsBoard(target, get)).toMatchObject({ body: { jobs: [] }, attempts: 1 });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it.each([
    { offset: 0, limit: 100, totalFound: 1, content: [] },
    { offset: 1, limit: 100, totalFound: 0, content: [] },
    { offset: 0, limit: 20, totalFound: 1, content: [{ id: "1" }] },
    { offset: 0, limit: 100, totalFound: 2, content: [{ id: "1" }, { id: "1" }] },
    { offset: 0, limit: 100, totalFound: 1, content: [{ id: "../other" }] },
  ])("rejects incomplete or unsafe list responses before detail fetches", async (body) => {
    const get = vi.fn<typeof getJson>().mockResolvedValue(ok(body));
    await expect(loadAtsBoard(target, get)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it.each(["changed total", "repeated page", "failed page"])("rejects %s during pagination", async (mode) => {
    const second = mode === "changed total" ? page(102, 100) : { ...page(101, 100), content: [{ id: "1" }] };
    const get = vi.fn<typeof getJson>().mockResolvedValueOnce(ok(page(101)))
      .mockResolvedValueOnce(mode === "failed page" ? failure : ok(second));
    await expect(loadAtsBoard(target, get)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it.each([
    { active: false }, { visibility: "INTERNAL" }, { id: "999" },
    { company: { name: "Other", identifier: "other" } }, { jobAd: {} },
  ])("rejects mismatched, inactive or malformed details: %j", async (change) => {
    const get = vi.fn<typeof getJson>().mockResolvedValueOnce(ok(page(1)))
      .mockResolvedValueOnce(ok({ ...detail("1"), ...change }));
    await expect(loadAtsBoard(target, get)).rejects.toThrow();
  });
  it("rejects the complete snapshot when one detail fails", async () => {
    const get = vi.fn<typeof getJson>().mockResolvedValueOnce(ok(page(2)))
      .mockResolvedValueOnce(ok(detail("1"))).mockResolvedValueOnce(failure);
    await expect(loadAtsBoard(target, get)).rejects.toThrow(/503/);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("requests XML text for Personio and validates its root", async () => {
    const get = vi.fn<typeof getJson>().mockResolvedValue(ok("<workzag-jobs/>"));
    expect(await loadAtsBoard({ ...target, source: "personio" }, get)).toMatchObject({ body: "<workzag-jobs/>" });
    expect(get).toHaveBeenCalledWith("https://example.jobs.personio.com/xml?language=en", { responseType: "text" });
    get.mockResolvedValue(ok("<html>Not found</html>"));
    await expect(loadAtsBoard({ ...target, source: "personio" }, get)).rejects.toThrow();
  });
  it("fails closed on Recruitee authentication without trying another endpoint", async () => {
    const get = vi.fn<typeof getJson>().mockResolvedValue({ ...failure, status: 401, attempts: 1, retryable: false });
    await expect(loadAtsBoard({ ...target, source: "recruitee" }, get)).rejects.toThrow(/401/);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("validates complete Workable envelopes before reporting success", async () => {
    const get = vi.fn<typeof getJson>().mockResolvedValue(ok({ jobs: [] }));
    await expect(loadAtsBoard({ ...target, source: "workable" }, get)).rejects.toThrow();
  });
  it("rejects unsupported sources and unsafe tenants without any network request", async () => {
    const get = vi.fn<typeof getJson>();
    await expect(loadAtsBoard({ ...target, source: "greenhouse" }, get)).rejects.toThrow(/Unsupported/);
    await expect(loadAtsBoard({ ...target, tenant: "example/../other" }, get)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});
