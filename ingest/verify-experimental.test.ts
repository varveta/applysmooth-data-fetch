import { afterEach, expect, it, vi } from "vitest";
import { verifier } from "./verify";
const description = "Build reliable software systems. ".repeat(20);
const pinpoint = {
  id: "1",
  title: "Engineer",
  url: "https://example.pinpointhq.com/en/postings/1",
  description,
  location: { city: "Austin", province: "Texas", country: "United States" },
};
const breezy = {
  id: "abc",
  name: "Engineer",
  url: "https://example.breezy.hr/p/abc-engineer",
  location: {
    city: "Austin",
    state: { name: "Texas" },
    country: { name: "United States" },
  },
};
const job = (source: "pinpoint" | "breezy") => ({
  id: "catalog",
  source,
  tenant: "example",
  source_job_id: source === "pinpoint" ? "1" : "abc",
  apply_url: source === "pinpoint" ? pinpoint.url : breezy.url,
  reason: "preview",
});
const pinpointHtml = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: pinpoint.title, identifier: { value: pinpoint.id } })}</script>`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
it.each(["pinpoint", "breezy"] as const)(
  "keeps %s off live verification by default",
  async (source) => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await verifier().check(job(source))).status).toBe("uncertain");
    expect(f).not.toHaveBeenCalled();
  },
);
it("confirms Pinpoint with board identity, then checks apply link; caches board reads", async () => {
  const f = vi.fn(async (url: unknown) =>
    String(url).endsWith("/postings.json")
      ? json({ data: [pinpoint] })
      : new Response(pinpointHtml),
  );
  vi.stubGlobal("fetch", f);
  const v = verifier({ allowExperimental: true });
  expect((await v.check(job("pinpoint"))).status).toBe("open");
  expect((await v.check(job("pinpoint"))).status).toBe("open");
  expect(
    f.mock.calls.filter(([url]) => String(url).endsWith("/postings.json")),
  ).toHaveLength(1);
});
it.each(["pinpoint", "breezy"] as const)(
  "withholds closure for absent or failed %s observation feeds",
  async (source) => {
    for (const response of [
      json(source === "pinpoint" ? { data: [] } : []),
      json({}, 404),
      json({}, 429),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      expect(
        (await verifier({ allowExperimental: true }).check(job(source))).status,
      ).toBe("uncertain");
    }
  },
);
it("closes Pinpoint only with explicit expired deadline and refuses changed application URLs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).endsWith("/postings.json")
        ? json({ data: [{ ...pinpoint, deadline_at: "2020-01-01T00:00:00Z" }] })
        : new Response(pinpointHtml),
    ),
  );
  expect(
    (await verifier({ allowExperimental: true }).check(job("pinpoint"))).status,
  ).toBe("closed");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).endsWith("/postings.json")
        ? json({ data: [{ ...pinpoint, url: pinpoint.url + "-changed" }] })
        : new Response(pinpointHtml),
    ),
  );
  expect(
    (await verifier({ allowExperimental: true }).check(job("pinpoint"))).status,
  ).toBe("uncertain");
});
it("verifies Breezy detail identity and explicit expiry without closing on parsing failure", async () => {
  for (const [expiry, status] of [
    [undefined, "open"],
    ["2020-01-01", "closed"],
  ] as const) {
    const ld = {
      "@type": "JobPosting",
      url: breezy.url,
      description,
      datePosted: "2026-11-01",
      validThrough: expiry,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).endsWith("/json")
          ? json([breezy])
          : new Response(
              `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
            ),
      ),
    );
    expect(
      (await verifier({ allowExperimental: true }).check(job("breezy"))).status,
    ).toBe(status);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).endsWith("/json")
        ? json([breezy])
        : new Response("<html>unrelated page</html>"),
    ),
  );
  expect(
    (await verifier({ allowExperimental: true }).check(job("breezy"))).status,
  ).toBe("uncertain");
});
