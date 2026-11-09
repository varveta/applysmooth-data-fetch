import { APPROVED_PUBLIC_FEEDS, isTestOnlySource } from "./lib/source-activation";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/lib/jobs-ingest/contract";
import { resolveMode, targetsFor, sourceNotBefore, recoveryTargets } from "./source-pipeline";

it("requires explicit activation before publishing while allowing secret-free testing", () => {
  expect(resolveMode("jobicy", "auto", "[]")).toBe("dry-run");
  expect(resolveMode("jobicy", "auto", '["jobicy"]')).toBe("publish");
  expect(resolveMode("jobicy", "dry-run", '["jobicy"]')).toBe("dry-run");
  expect(() => resolveMode("jobicy", "publish", "[]")).toThrow("not been activated");
  expect(() => resolveMode("jobicy", "auto", '["unknown"]')).toThrow();
});

describe.each(SOURCE_IDS.filter(source => !isTestOnlySource(source)))("%s independent pipeline", (source) => {
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

it("allows manual Greenhouse recovery without enabling its scheduled workflow", () => {
  const workflow = readFileSync(".github/workflows/greenhouse-recovery.yml", "utf8");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toMatch(/^\s+(schedule|push|pull_request|workflow_call):/m);
  expect(workflow).toContain("options: [dry-run, publish]");
  expect(workflow).toContain("default: dry-run");
  expect(workflow).toContain("options: [all, asana]");
  expect(workflow).toContain("default: all");
  expect(workflow).toContain("recovery_tenant: ${{ inputs.board == 'asana' && 'asana' || '' }}");
  expect(workflow).toContain("github.repository == 'varveta/applysmooth-data-fetch'");
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow).toContain("uses: ./.github/workflows/source-pipeline.yml");
  expect(workflow).toContain("source: greenhouse");
  expect(workflow).not.toContain("inputs.source");
  expect(workflow).toContain("mode: ${{ inputs.mode }}");
  expect(workflow).toContain("secrets: inherit");
  const runner = readFileSync(".github/workflows/source-pipeline.yml", "utf8");
  expect(runner).toContain("environment: test");
  expect(runner).toContain("group: collector-online");
  expect(runner).toContain("github.ref == 'refs/heads/main'");
  expect(runner).toContain("COLLECTOR_RECOVERY_TENANT: ${{ inputs.recovery_tenant }}");
});

it("restricts partial recovery to manual Asana runs and preserves normal full-source runs", () => {
  expect(recoveryTargets("greenhouse", "asana", "workflow_dispatch").map(target => target.tenant)).toEqual(["asana"]);
  expect(recoveryTargets("greenhouse", "", "schedule")).toEqual(targetsFor("greenhouse"));
  expect(recoveryTargets("lever", "", "workflow_dispatch")).toEqual(targetsFor("lever"));
  expect(() => recoveryTargets("greenhouse", "asana", "schedule")).toThrow("Unsupported manual recovery target");
  expect(() => recoveryTargets("greenhouse", "asana", "")).toThrow("Unsupported manual recovery target");
  expect(() => recoveryTargets("lever", "asana", "workflow_dispatch")).toThrow("Unsupported manual recovery target");
  expect(() => recoveryTargets("greenhouse", "unknown", "workflow_dispatch")).toThrow("Unsupported manual recovery target");
});

it("skips early polling without blocking other sources or future eligible runs", () => {
  const budget = '{"remotive":"2026-10-29T04:30:00Z"}';
  expect(sourceNotBefore("remotive", budget, new Date("2026-10-28T05:00:00Z"))).toBe("2026-10-29T04:30:00Z");
  expect(sourceNotBefore("ashby", budget, new Date("2026-10-28T05:00:00Z"))).toBeNull();
  expect(sourceNotBefore("remotive", budget, new Date("2026-10-29T05:00:00Z"))).toBeNull();
  expect(() => sourceNotBefore("remotive", '{"remotive":"invalid"}')).toThrow();
});

it.each(APPROVED_PUBLIC_FEEDS)("requires separate runtime activation for approved %s", source => {
  expect(resolveMode(source, "auto", "[]")).toBe("dry-run");
  expect(() => resolveMode(source, "publish", "[]")).toThrow("not been activated");
  expect(resolveMode(source, "auto", JSON.stringify([source]))).toBe("publish");
  expect(resolveMode(source, "dry-run", JSON.stringify([source]))).toBe("dry-run");
  expect(targetsFor(source).map(target => target.tenant)).toEqual(["public"]);
});
it.each(SOURCE_IDS.filter(isTestOnlySource))("keeps unapproved %s blocked even if runtime activation is misconfigured", source => {
  expect(() => resolveMode(source, "publish", JSON.stringify([source]))).toThrow("TEST-only");
  expect(() => resolveMode(source, "auto", JSON.stringify([source]))).toThrow("TEST-only");
});
