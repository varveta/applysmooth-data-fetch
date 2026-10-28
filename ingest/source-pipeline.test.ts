import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/lib/jobs-ingest/contract";
import { resolveMode, targetsFor, sourceNotBefore } from "./source-pipeline";

it("requires explicit activation before publishing while allowing secret-free testing", () => {
  expect(resolveMode("jobicy", "auto", "[]")).toBe("dry-run");
  expect(resolveMode("jobicy", "auto", '["jobicy"]')).toBe("publish");
  expect(resolveMode("jobicy", "dry-run", '["jobicy"]')).toBe("dry-run");
  expect(() => resolveMode("jobicy", "publish", "[]")).toThrow("not been activated");
  expect(() => resolveMode("jobicy", "auto", '["unknown"]')).toThrow();
});

describe.each(SOURCE_IDS)("%s independent pipeline", (source) => {
  it("has only its own distinct configured boards and an isolated workflow", () => {
    const targets = targetsFor(source);
    expect(targets.every((target) => target.source === source)).toBe(true);
    const workflow = readFileSync(`.github/workflows/jobs-${source}.yml`, "utf8");
    expect(workflow).toContain(`source: ${source}`);
    expect(workflow).toContain("default: dry-run");
    expect(workflow).toContain("uses: ./.github/workflows/source-pipeline.yml");
    const config = JSON.parse(readFileSync("ingest/config/sources.json", "utf8"));
    expect(workflow).toContain(`cron: '${config.sources[source].schedule_utc}'`);
  });
});

it("keeps all writers in the existing serialized queue and retains source reports", () => {
  const workflow = readFileSync(".github/workflows/source-pipeline.yml", "utf8");
  expect(workflow).toContain("group: collector-online");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("queue: max");
  expect(workflow).toContain("JOBS_ACTIVE_SOURCES");
  expect(workflow).toContain("if: always()");
  expect(workflow).toContain("path: ingest/data/source-*.json");
});

it("skips early polling without blocking other sources or future eligible runs", () => {
  const budget = '{"remotive":"2026-10-29T04:30:00Z"}';
  expect(sourceNotBefore("remotive", budget, new Date("2026-10-28T05:00:00Z"))).toBe("2026-10-29T04:30:00Z");
  expect(sourceNotBefore("ashby", budget, new Date("2026-10-28T05:00:00Z"))).toBeNull();
  expect(sourceNotBefore("remotive", budget, new Date("2026-10-29T05:00:00Z"))).toBeNull();
  expect(() => sourceNotBefore("remotive", '{"remotive":"invalid"}')).toThrow();
});
