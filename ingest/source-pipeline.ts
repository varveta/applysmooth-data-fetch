import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SOURCE_IDS, type SourceId } from "@/lib/jobs-ingest/contract";
import { loadBoard } from "./lib/load-board";
import { assertRunnerContext, clientFromEnv } from "./lib/collector-client";
import { errorLine, safeReason } from "./lib/diagnostics";
import { prepareBoard, runStateless, TargetSchema } from "./stateless";

export function resolveMode(source: SourceId, requested: string, activeJson: string) {
  const mode = z.enum(["auto", "dry-run", "publish"]).parse(requested);
  const active = z.array(z.enum(SOURCE_IDS)).parse(JSON.parse(activeJson));
  if (mode === "publish" && !active.includes(source))
    throw new Error("Source has not been activated for publication");
  return mode === "publish" || (mode === "auto" && active.includes(source)) ? "publish" : "dry-run";
}

/** One-time provider polling budgets can postpone a run without performing a fetch. */
export function sourceNotBefore(source: SourceId, raw: string, now = new Date()) {
  const values = z.record(z.string(), z.iso.datetime({ offset: true })).parse(JSON.parse(raw));
  for (const key of Object.keys(values)) z.enum(SOURCE_IDS).parse(key);
  const value = values[source];
  return value && Date.parse(value) > now.getTime() ? value : null;
}

export function targetsFor(source: SourceId) {
  const config = JSON.parse(readFileSync("ingest/config/sources.json", "utf8"));
  const targets = z.array(TargetSchema).min(1).parse(config.sources[source]?.targets);
  if (targets.some((target) => target.source !== source) || new Set(targets.map((target) => target.tenant)).size !== targets.length)
    throw new Error("Source configuration contains foreign or duplicate boards");
  return targets;
}

export async function runSource(source: SourceId, mode: "dry-run" | "publish") {
  const targets = targetsFor(source);
  const started = Date.now();
  const events: unknown[] = [];
  const log = (line: string) => {
    console.log(line);
    try { events.push(JSON.parse(line)); } catch { /* Keep reports structured and credential-free. */ }
  };
  let failed = false;
  try {
    if (mode === "publish") {
      assertRunnerContext();
      await runStateless({ targets, client: clientFromEnv(), log });
    } else {
      // Each source is validated separately; an unhealthy board does not suppress its peers.
      for (const target of targets) {
        const board = `${source}:${target.tenant}`;
        const boardStarted = Date.now();
        try {
          const fetched = await loadBoard(target);
          const prepared = prepareBoard(target, fetched.body, new Date(), {
            source, tenant: target.tenant, complete: true, identities: [],
          });
          log(JSON.stringify({ stage: "dry_run", board, fetched_count: prepared.fetched_count,
            accepted_count: prepared.rows.length, gates: prepared.gates,
            requests: fetched.attempts, bytes: fetched.bytes, duration_ms: Date.now() - boardStarted,
            ...("discovery" in fetched ? { discovery: fetched.discovery } : {}),
            writes: 0 }));
        } catch (error) {
          failed = true;
          log(errorLine("fetch", board, error));
        }
      }
      if (failed) throw new Error("One or more source boards failed validation");
    }
  } catch (error) {
    failed = true;
    log(JSON.stringify({ source, mode, error: safeReason(error) }));
    throw error;
  } finally {
    const report = { source, mode, success: !failed, boards: targets.length,
      started_at: new Date(started).toISOString(), duration_ms: Date.now() - started, events };
    mkdirSync("ingest/data", { recursive: true });
    writeFileSync(`ingest/data/source-${source}.json`, JSON.stringify(report, null, 2) + "\n");
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## ${source}\n\nMode: **${mode}** · Boards: **${targets.length}** · Result: **${failed ? "failed" : "passed"}**\n\nSee attached JSON for per-board counts. Dry runs do not write to Supabase.\n`);
  }
}

async function main() {
  const source = z.enum(SOURCE_IDS).parse(process.argv[2]);
  const notBefore = sourceNotBefore(source, process.env.COLLECTOR_SOURCE_NOT_BEFORE ?? "{}");
  if (notBefore) {
    const report = { source, success: true, mode: "cooldown", next_allowed_at: notBefore, writes: 0, requests: 0 };
    mkdirSync("ingest/data", { recursive: true });
    writeFileSync(`ingest/data/source-${source}.json`, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## ${source}\n\nProvider polling cooldown until ${notBefore}. No requests or database writes.\n`);
    return;
  }
  const mode = resolveMode(source, process.env.COLLECTOR_SOURCE_MODE ?? "dry-run", process.env.COLLECTOR_ACTIVE_SOURCES ?? "[]");
  await runSource(source, mode);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(errorLine("complete", "run", error)); process.exitCode = 1; });
