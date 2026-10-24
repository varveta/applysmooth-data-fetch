import type { JobLocation } from "./contract";
import { cleanText } from "./text";

const STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
};
const STATE_BY_NAME = new Map(
  Object.values(STATES).map((n) => [n.toLowerCase(), n]),
);

/** Explicit country names/codes seen in ATS location strings. Not exhaustive by design. */
const COUNTRIES: [RegExp, string][] = [
  [/\b(united states( of america)?|u\.s\.a?\.?)(?![a-z])/i, "US"],
  [/(^|[^A-Za-z])(USA|US|AMER-US|NA-US)(?![A-Za-z])/, "US"],
  [/\bcanada\b|(^|[^A-Za-z])CA-[A-Z]{2}\b/i, "CA"],
  [
    /\b(united kingdom|england|scotland|wales|northern ireland)\b|(^|[^A-Za-z])UK(?![A-Za-z])/i,
    "GB",
  ],
  [/\bireland\b/i, "IE"],
  [/\bindia\b/i, "IN"],
  [/\bgermany\b|\bdeutschland\b/i, "DE"],
  [/\bfrance\b/i, "FR"],
  [/\bspain\b/i, "ES"],
  [/\bnetherlands\b/i, "NL"],
  [/\bsingapore\b/i, "SG"],
  [/\bjapan\b/i, "JP"],
  [/\baustralia\b/i, "AU"],
  [/\bmexico\b|\bméxico\b/i, "MX"],
  [/\bbrazil\b|\bbrasil\b/i, "BR"],
  [/\bpoland\b/i, "PL"],
  [/\bisrael\b/i, "IL"],
  [/\bswitzerland\b/i, "CH"],
  [/\bsweden\b/i, "SE"],
  [/\bportugal\b/i, "PT"],
  [/\bitaly\b/i, "IT"],
  [/\bkorea\b/i, "KR"],
  [/\bchina\b|\bhong kong\b/i, "CN"],
  [/\bphilippines\b/i, "PH"],
  [/\bargentina\b/i, "AR"],
  [/\bcolombia\b/i, "CO"],
  [/\bromania\b/i, "RO"],
  [/\blithuania\b/i, "LT"],
  [/\bestonia\b/i, "EE"],
  [/\bczech\b/i, "CZ"],
  [/\bdenmark\b/i, "DK"],
  [/\bnorway\b/i, "NO"],
  [/\bfinland\b/i, "FI"],
  [/\bbelgium\b/i, "BE"],
  [/\baustria\b/i, "AT"],
  [/\bnew zealand\b/i, "NZ"],
  [/\buae\b|\bunited arab emirates\b/i, "AE"],
  [/\bsouth africa\b/i, "ZA"],
  [/\bserbia\b/i, "RS"],
  [/\bgreece\b/i, "GR"],
  [/\bbulgaria\b/i, "BG"],
  [/\btaiwan\b/i, "TW"],
  [/\bsaudi arabia\b/i, "SA"],
  [/\bqatar\b/i, "QA"],
  [/\bthailand\b/i, "TH"],
  [/\biceland\b/i, "IS"],
  [/\bhungary\b/i, "HU"],
  [/\bturkey\b|\bt[uü]rkiye\b/i, "TR"],
  [/\bindonesia\b/i, "ID"],
  [/\bvietnam\b/i, "VN"],
  [/\bmalaysia\b/i, "MY"],
  [/\bchile\b/i, "CL"],
  [
    /\b(costa rica|peru|uruguay|ukraine|nigeria|kenya|egypt|pakistan|bangladesh)\b/i,
    "ZZ",
  ],
  // Non-US regions stated explicitly. 'ZZ' = "outside the US, country not stated".
  [
    /\b(europe|emea|apac|asia[\s-]?pacific|latam|latin america|middle east)\b/i,
    "ZZ",
  ],
];

/**
 * Well-known non-US cities. Weaker than a country name or a US "City, ST" suffix
 * ("Paris, TX" stays US), so they are only consulted after both.
 */
const CITY_HINTS: [RegExp, string][] = [
  [
    /\bbengaluru\b|\bbangalore\b|\bhyderabad\b|\bpune\b|\bgurugram\b|\bgurgaon\b/i,
    "IN",
  ],
  [/\bberlin\b|\bmunich\b|\bmünchen\b/i, "DE"],
  [/\bparis\b/i, "FR"],
  [/\bmadrid\b|\bbarcelona\b/i, "ES"],
  [/\bamsterdam\b/i, "NL"],
  [/\btokyo\b/i, "JP"],
  [/\bsydney\b|\bmelbourne\b/i, "AU"],
  [/\bsão paulo\b|\bsao paulo\b/i, "BR"],
  [/\bwarsaw\b|\bkrakow\b|\bkraków\b/i, "PL"],
  [/\btel aviv\b/i, "IL"],
  [/\bzurich\b|\bzürich\b/i, "CH"],
  [/\bstockholm\b/i, "SE"],
  [/\blisbon\b/i, "PT"],
  [/\bmilan\b/i, "IT"],
  [/\bseoul\b/i, "KR"],
  [/\bshanghai\b|\bbeijing\b/i, "CN"],
  [/\bmanila\b/i, "PH"],
  [/\bbuenos aires\b/i, "AR"],
  [/\bbogot[aá]\b/i, "CO"],
  [/\bbucharest\b/i, "RO"],
  [/\bvilnius\b/i, "LT"],
  [/\btallinn\b/i, "EE"],
  [/\bprague\b/i, "CZ"],
  [/\bcopenhagen\b/i, "DK"],
  [/\boslo\b/i, "NO"],
  [/\bhelsinki\b/i, "FI"],
  [/\bbrussels\b/i, "BE"],
  [/\bvienna\b/i, "AT"],
  [/\bauckland\b/i, "NZ"],
  [/\bdubai\b/i, "AE"],
  [/\bcape town\b|\bjohannesburg\b/i, "ZA"],
  [/\bbelgrade\b/i, "RS"],
  [/\bathens\b/i, "GR"],
  [/\bsofia\b/i, "BG"],
  [/\btaipei\b/i, "TW"],
  [/\briyadh\b/i, "SA"],
  [/\bdoha\b/i, "QA"],
  [/\bbangkok\b/i, "TH"],
  [/\breykjav[ií]k\b/i, "IS"],
  [/\bbudapest\b/i, "HU"],
  [/\bistanbul\b/i, "TR"],
  [/\bjakarta\b/i, "ID"],
  [/\bhanoi\b|\bho chi minh\b/i, "VN"],
  [/\bkuala lumpur\b/i, "MY"],
  [/\bsantiago\b/i, "CL"],
  [/\blima\b|\bmontevideo\b|\bkyiv\b|\blagos\b|\bnairobi\b|\bcairo\b/i, "ZZ"],
  [
    /\btoronto\b|\bvancouver\b|\bmontreal\b|\bmontréal\b|\bottawa\b|\bcalgary\b|\bwaterloo\b/i,
    "CA",
  ],
];

/** US state codes that are also ISO-3166 country codes (CA = Canada, DE = Germany, IN = India…). */
const ISO_COLLISIONS = new Set([
  "AL",
  "AR",
  "AZ",
  "CA",
  "CO",
  "DE",
  "GA",
  "ID",
  "IL",
  "IN",
  "LA",
  "MA",
  "MD",
  "ME",
  "MN",
  "MS",
  "MT",
  "NC",
  "NE",
  "PA",
  "SC",
  "SD",
  "TN",
  "VA",
]);

/** Canadian provinces/territories. "Toronto, ON, CA" is Canada, never California. */
const PROVINCES: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};
const PROVINCE_BY_NAME = new Map(
  Object.values(PROVINCES).map((n) => [n.toLowerCase(), n]),
);

/** Country names that some ATS put in a structured country field. */
const COUNTRY_FIELD: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  us: "US",
};

export function countryFromField(
  value: string | null | undefined,
): string | null {
  const v = cleanText(value);
  if (!v) return null;
  if (/^[A-Z]{2}$/.test(v)) return v;
  const mapped = COUNTRY_FIELD[v.toLowerCase()];
  if (mapped) return mapped;
  for (const [re, code] of COUNTRIES) if (re.test(v)) return code;
  return null;
}

function countriesIn(
  text: string,
  table: [RegExp, string][] = COUNTRIES,
): string[] {
  const found: string[] = [];
  for (const [re, code] of table)
    if (re.test(text) && !found.includes(code)) found.push(code);
  return found;
}

const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/i;

// Drop trailing qualifiers before matching a region: "CO - Hybrid", "California (HQ)".
const bareRegion = (part: string) =>
  part.replace(/\s*(?:[-–(]|\b(?:hybrid|remote|on-?site|hq)\b).*$/i, "").trim();
const statePartIndex = (parts: string[]) =>
  parts.findIndex(
    (part, i) =>
      i > 0 &&
      ((/^[A-Z]{2}$/.test(bareRegion(part)) && STATES[bareRegion(part)]) ||
        STATE_BY_NAME.has(bareRegion(part).toLowerCase())),
  );

/** A conflicting city/country code must stay unknown even when an office supplies a country. */
export function hasAmbiguousCountryLocation(raw: string): boolean {
  const parts = cleanText(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const stateIdx = statePartIndex(parts);
  return (
    stateIdx > 0 &&
    ISO_COLLISIONS.has(bareRegion(parts[stateIdx])) &&
    !countriesIn(raw).includes("US") &&
    countriesIn(parts.slice(0, stateIdx).join(", "), CITY_HINTS).some(
      (country) => country !== "US",
    )
  );
}

/**
 * Parse one source location string. Only explicit statements set `country`:
 * an explicit country, a "City, ST" US state suffix, or a bare US state name.
 * A bare city ("Chicago", "Dublin") stays country = null.
 */
export function parseLocationText(raw: string): JobLocation[] {
  const text = cleanText(raw);
  if (!text || /^(n\/a|na|none|tbd|-)$/i.test(text)) return [];
  const segments = text
    // "OR" following a comma is Oregon, not the conjunction between two locations.
    .split(/\s*(?:;|\||\n|\s\/\s|(?<!, ?)\bor\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: JobLocation[] = [];
  for (const seg of segments) {
    const remote = REMOTE.test(seg);
    const parts = seg
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    const lastWord = last.replace(/[().]/g, "").trim();
    const cityOf = (idx: number) =>
      parts
        .slice(0, idx)
        .join(", ")
        .replace(REMOTE, "")
        .replace(/[-–(]\s*$/, "")
        .trim() || null;
    // Precedence: Canadian province → explicit country name → US state suffix → city hints.
    const provinceIdx = parts.findIndex(
      (p, i) =>
        i > 0 &&
        (PROVINCES[bareRegion(p)] ||
          PROVINCE_BY_NAME.has(bareRegion(p).toLowerCase())),
    );
    if (provinceIdx > 0) {
      const p = bareRegion(parts[provinceIdx]);
      out.push({
        raw: seg,
        city: cityOf(provinceIdx),
        region: PROVINCES[p] ?? PROVINCE_BY_NAME.get(p.toLowerCase()) ?? null,
        country: "CA",
        remote,
      });
      continue;
    }
    const named = countriesIn(seg);
    const nonUsNamed = named.filter((c) => c !== "US");
    const stateIdx = statePartIndex(parts);
    // "Toronto, CA" / "Berlin, DE": a state code that is also an ISO country code, next to a
    // well-known foreign city, is ambiguous. Keep the country unknown rather than guess US.
    if (hasAmbiguousCountryLocation(seg)) {
      out.push({
        raw: seg,
        city: cityOf(stateIdx),
        region: null,
        country: null,
        remote,
      });
      continue;
    }
    // "Perth, WA, Australia": an explicit foreign country outranks a US-looking code.
    if (stateIdx > 0 && !(nonUsNamed.length && !named.includes("US"))) {
      const p = bareRegion(parts[stateIdx]);
      out.push({
        raw: seg,
        city: cityOf(stateIdx),
        region: STATES[p] ?? STATE_BY_NAME.get(p.toLowerCase()) ?? null,
        country: "US",
        remote,
      });
      continue;
    }
    const countries = named.length ? named : countriesIn(seg, CITY_HINTS);
    if (countries.length) {
      for (const country of countries)
        out.push({
          raw: seg,
          city: parts.length > 1 && !REMOTE.test(parts[0]) ? parts[0] : null,
          region: null,
          country,
          remote,
        });
      continue;
    }
    // Bare US state name ("California", "Remote - New York") counts as explicit US.
    const stateOnly = STATE_BY_NAME.get(
      lastWord
        .replace(REMOTE, "")
        .replace(/^[\s\-–:]+/, "")
        .toLowerCase(),
    );
    if (stateOnly && parts.length === 1) {
      out.push({
        raw: seg,
        city: null,
        region: stateOnly,
        country: "US",
        remote,
      });
      continue;
    }
    if (parts.length > 1 && !remote) {
      // "San Francisco, Seattle, New York": several bare cities, country unstated.
      for (const p of parts)
        out.push({
          raw: p,
          city: p,
          region: null,
          country: null,
          remote: false,
        });
      continue;
    }
    out.push({
      raw: seg,
      city: remote ? null : seg,
      region: null,
      country: null,
      remote,
    });
  }
  return out;
}

export function dedupeLocations(locations: JobLocation[]): JobLocation[] {
  const seen = new Set<string>();
  return locations.filter((l) => {
    const k =
      `${l.city ?? ""}|${l.region ?? ""}|${l.country ?? ""}|${l.remote}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * US eligibility from explicit statements only:
 * - any location with country US → `us`
 * - every location has an explicit non-US country → `not_us`
 * - anything else (bare city, "Remote" without country, empty) → `unknown`
 */
export function usEligibility(
  locations: JobLocation[],
): "us" | "not_us" | "unknown" {
  if (locations.some((l) => l.country === "US")) return "us";
  const stated = locations.filter((l) => l.country);
  // A bare "Remote" listed next to explicit non-US countries ("Remote; AU; Singapore") is remote there.
  const rest = locations.filter((l) => !l.country);
  if (stated.length && rest.every((l) => l.remote && !l.city && !l.region))
    return "not_us";
  return "unknown";
}

export function formatLocations(
  locations: JobLocation[],
  fallback: string,
): string {
  const shown = locations.map((l) => {
    const place = [
      l.city,
      l.region,
      l.country && l.country !== "US" ? l.country : null,
    ]
      .filter(Boolean)
      .join(", ");
    const where = place || (l.country === "US" ? "United States" : "");
    return l.remote ? (where ? `Remote (${where})` : "Remote") : where || l.raw;
  });
  const text = [...new Set(shown.filter(Boolean))].join("; ");
  return (text || cleanText(fallback)).slice(0, 250);
}
