import { z } from "zod";
import {
  pinpoint,
  PinpointPosting,
  pinpointUrl,
} from "../../src/lib/jobs-ingest/pinpoint";
import { getJson } from "./http";

const date = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .nullish();
const detail = z.object({
  "@type": z.literal("JobPosting"),
  title: z.string(),
  identifier: z.object({ value: z.string() }),
  datePosted: date,
  validThrough: date,
});
export function pinpointDetail(html: string, id: string, title: string) {
  const matches = [];
  for (const block of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const data = JSON.parse(block[1]);
    for (const item of Array.isArray(data) ? data : [data]) {
      if (
        typeof item !== "object" ||
        item === null ||
        item["@type"] !== "JobPosting"
      )
        continue;
      const parsed = detail.parse(item);
      if (
        parsed.identifier.value === id &&
        parsed.title.trim() === title.trim()
      )
        matches.push(parsed);
    }
  }
  if (matches.length !== 1)
    throw new Error("Missing or ambiguous Pinpoint detail identity");
  return matches[0];
}

/** The feed omits original publication dates; matching job pages supply them. */
export async function loadPinpointBoard(
  target: { tenant: string },
  get: typeof getJson = getJson,
) {
  const listing = await get(pinpoint.listUrl(target.tenant), {
    maxBytes: 12_000_000,
    attempts: 2,
  });
  if (!listing.ok) throw new Error(listing.error);
  const jobs = pinpoint
    .parseListing(listing.body)
    .map((raw) => PinpointPosting.parse(raw));
  if (jobs.length > 500)
    throw new Error("Pinpoint detail request budget exceeded");
  // Feed IDs are numeric; page JobPosting IDs are the UUID in the public URL.
  // Keep the feed ID as canonical identity and verify the page UUID separately.
  const pageId = (url: string) => {
    const parsed = new URL(pinpointUrl(url, target.tenant));
    const match = parsed.pathname.match(
      /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?postings\/([a-zA-Z0-9_-]{1,120})\/?$/,
    );
    if (!match || parsed.search || parsed.hash)
      throw new Error("Invalid Pinpoint detail path");
    return match[1];
  };
  for (const job of jobs) pageId(job.url);
  let attempts = listing.attempts,
    bytes = listing.bytes;
  const data = [];
  for (const job of jobs) {
    const response = await get(pinpointUrl(job.url, target.tenant), {
      responseType: "text",
      accept: "text/html",
      maxBytes: 2_000_000,
      timeoutMs: 20_000,
      attempts: 1,
    });
    if (!response.ok) throw new Error(response.error);
    attempts += response.attempts;
    bytes += response.bytes;
    const page = pinpointDetail(
      z.string().parse(response.body),
      pageId(job.url),
      job.title,
    );
    data.push({
      ...job,
      detail_posted_at: page.datePosted,
      detail_expires_at: page.validThrough,
    });
  }
  return {
    body: { data },
    attempts,
    bytes,
    discovery: {
      policy: "observations" as const,
      pages: 1 + jobs.length,
      capped: false,
    },
  };
}
