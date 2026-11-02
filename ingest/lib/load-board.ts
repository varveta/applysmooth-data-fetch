import { loadRemotefirstjobsBoard } from "./fetch-remotefirstjobs";
import { loadRailsJobsBoard } from "./fetch-rails-jobs";
import { loadGetworkBoard } from "./fetch-getwork";
import { loadSpacejobsBoard } from "./fetch-spacejobs";
import { loadTeamtailorBoard } from "./fetch-teamtailor";
import { loadYubhubBoard } from "./fetch-yubhub";
import { loadRemoteBackendJobsBoard } from "./fetch-remote-backend-jobs";
import { loadGetonboardBoard } from "./fetch-getonboard";
import { loadPinpointBoard } from "./fetch-pinpoint";
import { loadTrakstarBoard } from "./fetch-trakstar";
import { loadManatalBoard } from "./fetch-manatal";
import { loadBreezyBoard } from "./fetch-breezy";
import { ADAPTERS } from "@/lib/jobs-ingest/adapters";
import type { SourceId } from "@/lib/jobs-ingest/contract";
import { getJson } from "./http";
import { loadAtsBoard } from "./fetch-ats";
import { loadFeedBoard } from "./fetch-feeds";

export const DISCOVERY_SOURCES: readonly SourceId[] = ["jobicy", "himalayas", "weworkremotely", "remoteok", "remotive"];
export type BoardTarget = { source: SourceId; tenant: string; company: string };

/** A failed page or detail aborts before any row is published. */
export async function loadBoard(target: BoardTarget, get: typeof getJson = getJson) {
  if (target.source === "remotefirstjobs") return loadRemotefirstjobsBoard(target, get);
  if (target.source === "railsjobs") return loadRailsJobsBoard(target, get);
  if (target.source === "getwork") return loadGetworkBoard(target, get);
  if (target.source === "spacejobs") return loadSpacejobsBoard(target, get);
  if (target.source === "teamtailor") return loadTeamtailorBoard(target, get);
  if (target.source === "yubhub") return loadYubhubBoard(target, get);
  if (target.source === "remotebackendjobs") return loadRemoteBackendJobsBoard(target, get);
  if (target.source === "getonboard") return loadGetonboardBoard(target, get);
  if (target.source === "trakstar") return loadTrakstarBoard(target, get);
  if (target.source === "manatal") return loadManatalBoard(target, get);
  if (target.source === "breezy") return loadBreezyBoard(target, get);
  if (["smartrecruiters", "workable", "personio", "recruitee"].includes(target.source))
    return loadAtsBoard(target, get);
  if (DISCOVERY_SOURCES.includes(target.source)) return loadFeedBoard(target, get);
  if (target.source === "pinpoint") return loadPinpointBoard(target, get);
  const result = await get(ADAPTERS[target.source].listUrl(target.tenant));
  if (!result.ok) throw new Error(result.error);
  return { body: result.body, attempts: result.attempts, bytes: result.bytes };
}
