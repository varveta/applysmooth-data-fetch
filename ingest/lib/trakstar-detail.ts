import { z } from "zod";
/** Some Trakstar templates emit literal newlines inside JSON strings. Escape
 * only those control characters; never evaluate scripts or repair other syntax. */
export function parseTemplateJson(text: string): unknown {
  let quoted = false,
    escaped = false,
    out = "";
  for (const c of text) {
    if (quoted && c.charCodeAt(0) < 32) {
      out += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    out += c;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
  }
  return JSON.parse(out);
}
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
export function trakstarDetail(html: string, id: string, title: string) {
  const matching = [];
  for (const block of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const json = parseTemplateJson(block[1]);
    for (const candidate of Array.isArray(json) ? json : [json]) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        candidate["@type"] !== "JobPosting"
      )
        continue;
      const d = detail.parse(candidate);
      if (d.identifier.value === id && d.title.trim() === title.trim())
        matching.push(d);
    }
  }
  if (matching.length !== 1)
    throw new Error("Missing or ambiguous Trakstar detail identity");
  return matching[0];
}
