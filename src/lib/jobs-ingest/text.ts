import { createHash } from "node:crypto";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  bull: "•",
  middot: "·",
  trade: "™",
  reg: "®",
  copy: "©",
};

export function decodeEntities(input: string): string {
  return input.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1].toLowerCase() === "x"
            ? parseInt(code.slice(2), 16)
            : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000
          ? String.fromCodePoint(n)
          : match;
      }
      return NAMED[code.toLowerCase()] ?? match;
    },
  );
}

/** HTML → readable plain text. Never executes or keeps markup. */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse escapes its HTML once more (`&lt;p&gt;`); decode until markup is real.
  for (let i = 0; i < 2 && /&lt;\/?[a-z]/i.test(s); i++) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  if (!/<\/?[a-z][^>]*>/i.test(s))
    return decodeEntities(s).replace(/ /g, " ").trim();

  const lists: { ordered: boolean; next: number; inItem: boolean }[] = [];
  let out = "";
  const itemIndent = () =>
    lists.at(-1)?.inItem ? "  ".repeat(lists.length) : "";
  const breakLine = (count = 1) => {
    out = out.replace(/[ \t]+$/, "");
    const existing = out.match(/\n*$/)?.[0].length ?? 0;
    if (out && existing < count) out += "\n".repeat(count - existing);
  };
  const append = (text: string) => {
    const readable = decodeEntities(text).replace(/\s+/g, " ");
    if (!readable.trim()) {
      if (out && !/\s$/.test(out)) out += " ";
      return;
    }
    if (!out || out.endsWith("\n")) out += itemIndent() + readable.trimStart();
    else out += readable;
  };
  const integerAttribute = (
    tag: string,
    attribute: string,
    fallback: number,
  ) => {
    const value = new RegExp(
      `\\b${attribute}\\s*=\\s*["']?(-?\\d{1,6})(?=["'\\s>])`,
      "i",
    ).exec(tag)?.[1];
    return value === undefined ? fallback : Number(value);
  };
  let cursor = 0;
  for (const match of s.matchAll(/<\/?[a-z][^>]*>/gi)) {
    append(s.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const tag = /^<\s*(\/?)\s*([a-z][\w-]*)/i.exec(match[0]);
    if (!tag) continue;
    const closing = !!tag[1];
    const name = tag[2].toLowerCase();
    if (name === "ul" || name === "ol") {
      breakLine();
      if (closing) lists.pop();
      else
        lists.push({
          ordered: name === "ol",
          next: integerAttribute(match[0], "start", 1),
          inItem: false,
        });
    } else if (name === "li") {
      breakLine();
      const list = lists.at(-1);
      if (closing) {
        if (list) list.inItem = false;
      } else {
        const number = integerAttribute(match[0], "value", list?.next ?? 1);
        if (list) {
          list.inItem = true;
          list.next = number + 1;
        }
        out += `${"  ".repeat(Math.max(0, lists.length - 1))}${list?.ordered ? `${number}.` : "•"} `;
      }
    } else if (name === "br") {
      breakLine();
    } else if (/^(?:p|div|h[1-6]|tr|table|section|blockquote)$/.test(name)) {
      // <li><p> must not separate the bullet marker from its first paragraph.
      if (/(?:^|\n)\s*(?:•|-?\d+\.) $/.test(out)) continue;
      breakLine(2);
    }
  }
  append(s.slice(cursor));
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

export function sha256(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

/** Sentences for evidence extraction; keeps list items as their own units. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter((s) => s.length > 0);
}

export function quote(s: string): string {
  const t = cleanText(s);
  return t.length > 300 ? `${t.slice(0, 297)}...` : t;
}

export function toIso(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname.includes(".") &&
      !/^(localhost|127\.|10\.|192\.168\.|0\.)/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
