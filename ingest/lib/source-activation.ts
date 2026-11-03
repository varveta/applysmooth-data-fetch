import { isExperimentalSource, type SourceId } from "@/lib/jobs-ingest/contract";

/** Approved publication scope; runtime JOBS_ACTIVE_SOURCES remains required. */
export const APPROVED_PUBLIC_FEEDS = ["spacejobs", "railsjobs", "remotefirstjobs"] as const;
export const isTestOnlySource = (source: SourceId) =>
  isExperimentalSource(source) && !(APPROVED_PUBLIC_FEEDS as readonly string[]).includes(source);
