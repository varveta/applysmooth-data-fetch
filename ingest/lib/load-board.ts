import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import type { SourceId } from "@/lib/jobs-ingest/contract";
import { getJson } from "./http";
import { loadAtsBoard } from "./fetch-ats";
import { loadFeedBoard } from "./fetch-feeds";

export const DISCOVERY_SOURCES: readonly SourceId[] = ["jobicy", "himalayas", "weworkremotely", "remoteok", "remotive"];
export type BoardTarget = { source: SourceId; tenant: string; company: string };

/** A failed page or detail aborts before any row is published. */
export async function loadBoard(target: BoardTarget, get: typeof getJson = getJson) {
  if (["smartrecruiters", "workable", "personio", "recruitee"].includes(target.source))
    return loadAtsBoard(target, get);
  if (DISCOVERY_SOURCES.includes(target.source)) return loadFeedBoard(target, get);
  const result = await get(ADAPTERS[target.source].listUrl(target.tenant));
  if (!result.ok) throw new Error(result.error);
  return { body: result.body, attempts: result.attempts, bytes: result.bytes };
}
