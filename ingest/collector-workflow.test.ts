import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/collector.yml", "utf8");
// Inspect the small job-level concurrency blocks without adding a runtime YAML dependency.
const jobs = new Map(
  [...(workflow.split(/^jobs:\n/m)[1] ?? "").matchAll(/^  ([a-z_-]+):\n([\s\S]*?)(?=^  [a-z_-]+:\n|$(?![\s\S]))/gm)]
    .map((match) => [match[1], match[2]]),
);
function concurrency(job: string) {
  const block = jobs.get(job)?.match(/^    concurrency:\n((?:      .*\n)+)/m)?.[1];
  if (!block) return undefined;
  return Object.fromEntries(
    [...block.matchAll(/^      ([a-z-]+): (.+)$/gm)].map((match) => [match[1], match[2]]),
  );
}

it("keeps CI and rehearsal out of the publication concurrency queue", () => {
  expect(workflow.split(/^jobs:\n/m)[0]).not.toMatch(/^concurrency:/m);
  for (const job of ["test", "rehearsal"]) {
    expect(jobs.has(job)).toBe(true);
    expect(concurrency(job)).toBeUndefined();
  }
});

it("serializes both publishers and retains pending publication jobs", () => {
  const legacy = concurrency("publish"), stateless = concurrency("stateless");
  expect(legacy?.group).toBeTruthy();
  expect(stateless?.group).toBe(legacy?.group);
  for (const settings of [legacy, stateless]) {
    expect(settings?.["cancel-in-progress"]).toBe("false");
    expect(settings?.queue).toBe("max");
  }
});
