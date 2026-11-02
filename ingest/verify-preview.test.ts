import { expect, it, vi } from "vitest";
import { verifyPreview } from "./verify-preview";
import { validateTargets } from "./validate-targets";
import { verifier } from "./verify";
const target = { source: "pinpoint", tenant: "example", company: "Example" };
const job = {
  id: "1",
  title: "Engineer",
  url: "https://example.pinpointhq.com/en/postings/1",
  description: "Build software. ".repeat(30),
  location: { country: "United States" },
};
const validate: typeof validateTargets = (manifest, opts) =>
  validateTargets(manifest, {
    ...opts,
    get: async (url) => ({
      ok: true,
      status: 200,
      attempts: 1,
      bytes: 50,
      body: url.endsWith("/postings.json")
        ? { data: [job] }
        : `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: job.title, identifier: { value: job.id } })}</script>`,
    }),
  });
it("reports thrown checks as uncertain rather than successful partial verification", async () => {
  const checker = {
    ...verifier(),
    check: vi.fn(async () => {
      throw new Error("timeout");
    }),
  };
  const r = await verifyPreview(
    { targets: [target] },
    { source: "pinpoint", validate, checker },
  );
  expect(r).toMatchObject({
    success: false,
    writes: 0,
    boards: [{ checked: 1, outcomes: { uncertain: 1 } }],
  });
});
it("requires nonempty successful verification and refuses production sources before fetch", async () => {
  const validate = vi.fn();
  await expect(
    verifyPreview({ targets: [] }, { source: "remotive", validate }),
  ).rejects.toThrow();
  expect(validate).not.toHaveBeenCalled();
  const r = await verifyPreview(
    { targets: [target] },
    {
      source: "pinpoint",
      validate: (manifest, opts) =>
        validateTargets(manifest, {
          ...opts,
          get: async () => ({
            ok: true,
            status: 200,
            attempts: 1,
            bytes: 1,
            body: { data: [] },
          }),
        }),
    },
  );
  expect(r.success).toBe(false);
  expect(r.boards[0].unverified).toBe(true);
});
