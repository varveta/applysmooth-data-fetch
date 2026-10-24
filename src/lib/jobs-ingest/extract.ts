import type {
  EmploymentOption,
  Evidence,
  ExperienceLevel,
  JobType,
  Salary,
  SalaryPeriod,
  VisaOption,
  WorkMode,
} from "./contract";
import { cleanText, quote, sentences } from "./text";

/**
 * Deterministic, evidence-backed field extraction. No AI. Every positive value
 * records the exact text it came from; anything not stated stays unknown.
 */

type Found<T> = { value: T; evidence: Evidence } | null;

export function workModeFromStructured(
  value: string | null | undefined,
  sourceField: string,
): Found<WorkMode> {
  const v = cleanText(value)
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  const mode = (
    {
      remote: "Remote",
      hybrid: "Hybrid",
      onsite: "On-site",
      inoffice: "On-site",
    } as const
  )[v as "remote"];
  return mode
    ? {
        value: mode,
        evidence: {
          field: "workMode",
          value: mode,
          quote: quote(value ?? ""),
          method: "structured",
          sourceField,
        },
      }
    : null;
}

/** Location/title text: "Remote" and "Hybrid" are explicit; a city never implies On-site. */
export function workModeFromText(
  text: string,
  sourceField: string,
): Found<WorkMode> {
  const t = cleanText(text);
  const mode: WorkMode | null = /\bhybrid\b/i.test(t)
    ? "Hybrid"
    : /\bremote\b/i.test(t)
      ? "Remote"
      : /\b(on-?site|in[- ]office)\b/i.test(t)
        ? "On-site"
        : null;
  return mode
    ? {
        value: mode,
        evidence: {
          field: "workMode",
          value: mode,
          quote: quote(t),
          method: sourceField === "title" ? "title" : "text-pattern",
          sourceField,
        },
      }
    : null;
}

const JOB_TYPE_WORDS: [RegExp, JobType][] = [
  [/^(full[\s_-]?time|fulltime|permanent|regular)$/i, "Full-time"],
  [/^(part[\s_-]?time|parttime)$/i, "Part-time"],
  [/^(intern|internship|co-?op)$/i, "Internship"],
  [/^(contract|contractor|fixed[\s_-]?term)$/i, "Contract"],
];

export function jobTypeFromStructured(
  value: string | null | undefined,
  sourceField: string,
): Found<JobType> {
  const v = cleanText(value);
  // "Full-time - Hybrid", "Full time (Permanent)": take the first recognizable word group.
  const head = v.split(/[-–(,/]| - /)[0].trim();
  for (const [re, type] of JOB_TYPE_WORDS)
    if (re.test(head) || re.test(v))
      return {
        value: type,
        evidence: {
          field: "jobType",
          value: type,
          quote: quote(v),
          method: "structured",
          sourceField,
        },
      };
  return null;
}

/** Title statements only: "Software Engineering Intern", "Analyst (Contract)", "Part-Time Tutor". */
export function jobTypeFromTitle(title: string): Found<JobType> {
  const type: JobType | null = /\bintern(ship)?\b|\bco-?op\b/i.test(title)
    ? "Internship"
    : /\bpart[\s-]?time\b/i.test(title)
      ? "Part-time"
      : /\b(contract|contractor|temp(orary)?)\b/i.test(title) &&
          !/\bcontract (management|manufacturing|manager|specialist|analyst|administrator|attorney|counsel|negotiator)/i.test(
            title,
          )
        ? "Contract"
        : null;
  return type
    ? {
        value: type,
        evidence: {
          field: "jobType",
          value: type,
          quote: quote(title),
          method: "title",
          sourceField: "title",
        },
      }
    : null;
}

/**
 * Seniority words in the title. Staff/Principal/numbered levels are not mapped:
 * the UI has no equivalent and guessing would mislead. Absence of a word is not "Mid level".
 */
export function experienceFromTitle(title: string): Found<ExperienceLevel> {
  const t = title;
  const level: ExperienceLevel | null =
    /\b(team lead|tech lead|lead)\b/i.test(t) &&
    !/\blead (generation|gen)\b/i.test(t)
      ? "Lead"
      : /\b(senior|sr\.?)(?![a-z])/i.test(t)
        ? "Senior level"
        : /\b(mid[\s-]?level|intermediate)\b/i.test(t)
          ? "Mid level"
          : /\b(junior|jr\.?|entry[\s-]?level|new grad(uate)?|early career|apprentice)(?![a-z])/i.test(
                t,
              )
            ? "Entry level"
            : null;
  return level
    ? {
        value: level,
        evidence: {
          field: "experience",
          value: level,
          quote: quote(title),
          method: "title",
          sourceField: "title",
        },
      }
    : null;
}

export function periodFromInterval(
  value: string | null | undefined,
): SalaryPeriod | null {
  const v = cleanText(value).toLowerCase();
  if (/year|annual|yr/.test(v)) return "year";
  if (/hour|hr|wage/.test(v)) return "hour";
  if (/month/.test(v)) return "month";
  if (/day|daily/.test(v)) return "day";
  return null;
}

export function formatSalaryText(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: SalaryPeriod | null,
): string {
  const fmt = (n: number) => {
    if (currency) {
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(n);
      } catch {
        /* fall through */
      }
    }
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const range =
    min != null && max != null && max !== min
      ? `${fmt(min)}–${fmt(max)}`
      : min != null
        ? `${fmt(min)}+`
        : max != null
          ? `Up to ${fmt(max)}`
          : "";
  return `${range}${period ? ` ${period === "hour" ? "an" : "a"} ${period}` : ""}`.slice(
    0,
    150,
  );
}

const PLAUSIBLE: Record<SalaryPeriod, [number, number]> = {
  year: [10_000, 2_000_000],
  month: [800, 200_000],
  day: [40, 10_000],
  hour: [7, 1_000],
};

export function plausibleSalary(s: Salary): boolean {
  const values = [s.min, s.max].filter((n): n is number => n != null);
  if (!values.length) return false;
  if (s.min != null && s.max != null && s.max < s.min) return false;
  if (!s.period) return true;
  const [lo, hi] = PLAUSIBLE[s.period];
  return values.every((n) => n >= lo && n <= hi);
}

// Do not truncate unsupported amounts such as "$250B" to "$250".
const MONEY = String.raw`(?:US\$|USD\s?\$?|\$)\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?(?![\w,])`;
const RANGE_RE = new RegExp(
  `${MONEY}(?:\\s?(?:USD)?\\s?(?:-|–|—|to)\\s?${MONEY})?(?:\\s?USD)?`,
);

/**
 * Pay-transparency text: "$150,000 - $200,000 USD per year". Currency is USD only
 * when "USD"/"US$" is written; period only when an explicit period word is in the
 * same sentence. Otherwise those fields stay null (shown as text, never filtered).
 */
export function salaryFromText(
  text: string,
): { salary: Salary; evidence: Evidence } | null {
  for (const s of sentences(text)) {
    if (s.length > 600) continue;
    const m = RANGE_RE.exec(s);
    if (!m) continue;
    if (!/\b(salary|compensation|pay|base|wage|rate|range|ote)\b/i.test(s))
      continue;
    const num = (n?: string, k?: string) =>
      n ? Number(n.replace(/,/g, "")) * (k ? 1000 : 1) : null;
    const min = num(m[1], m[2]);
    const max = num(m[3], m[4]);
    const currency = /\bUSD\b|US\$/.test(s) ? "USD" : null;
    const period: SalaryPeriod | null =
      /(per year|annual(ly)?|a year|per annum|\/\s?y(ea)?r\b|yearly)/i.test(s)
        ? "year"
        : /(per hour|hourly|an hour|\/\s?h(ou)?r\b)/i.test(s)
          ? "hour"
          : /(per month|monthly|\/\s?mo(nth)?\b)/i.test(s)
            ? "month"
            : null;
    const salary: Salary = {
      min,
      max,
      currency,
      period,
      text: formatSalaryText(min, max, currency, period) || cleanText(m[0]),
    };
    if (!plausibleSalary(salary)) continue;
    return {
      salary,
      evidence: {
        field: "salary",
        value: salary.text,
        quote: quote(s),
        method: "text-pattern",
        sourceField: "description",
      },
    };
  }
  return null;
}

const NEGATION =
  /\b(not|no|unable|cannot|can't|can not|won't|will not|without|ineligible|doesn't|does not|don't|do not|isn't|is not|aren't|nor|never|neither)\b/i;

/** Affirmative, candidate-facing sponsorship statements. Job duties ("manage the sponsorship policy") do not match. */
const SPONSOR_OFFERED = new RegExp(
  [
    String.raw`\bsponsorship\b[^.]{0,40}\b(is|are|will be|may be)\s+(available|offered|provided)\b`,
    String.raw`\bwe\s+(will|can|do|are able to)\s+(also\s+)?sponsor\b`,
    String.raw`\b(willing|able|happy|open)\s+to\s+sponsor\b`,
    String.raw`\b(offer|offers|provide|provides)\s+(visa\s+|H-?1-?B\s+)?sponsorship\b`,
    String.raw`\beligible\s+for\s+(visa\s+|H-?1-?B\s+)?sponsorship\b`,
  ].join("|"),
  "i",
);
/** [strict positive pattern, broad mention pattern]. Exclusions use the broad one: hiding is the safe direction. */
const ENGAGEMENT: [RegExp, RegExp, EmploymentOption][] = [
  [
    /\bW-?2\b\s*(only|employee|employment|position|role|basis|contract|hourly|candidates)|\b(on|as)\s+(a\s+)?W-?2\b|\bW-?2\s*\/\s*(1099|C2C)\b/i,
    /\bW-?2\b/,
    "W-2",
  ],
  [
    /\b1099\s*(only|contract(or)?|basis|position|role|employee|candidates)|\b(on|as)\s+(a\s+)?1099\b|\b(W-?2|C2C)\s*\/\s*1099\b/i,
    /\b1099\b(?!\s*-?\s*S\b)/,
    "1099",
  ],
  [/\b(C2C|corp[\s-]to[\s-]corp)\b/i, /\b(C2C|corp[\s-]to[\s-]corp)\b/i, "C2C"],
];

/** Sentences for eligibility: lines that continue mid-sentence are re-joined first. */
function eligibilitySentences(text: string): string[] {
  return sentences(
    text.replace(/\n(?=[a-z(])/g, " ").replace(/([^.!?:\n])\n(?!•)/g, "$1 "),
  );
}

export type Eligibility = {
  visas: VisaOption[];
  visaSponsorship: "offered" | "not_offered" | null;
  employment: EmploymentOption[];
  employmentExcluded: EmploymentOption[];
  evidence: Evidence[];
};

/**
 * Visa / engagement statements. Conservative by construction:
 * - a sentence with any negation word never produces a positive value;
 * - H1B requires "H-1B"/"H1B" named in a positive sponsorship sentence;
 * - generic "visa sponsorship available" sets visaSponsorship=offered but no filter value;
 * - "Contract" never implies 1099/C2C.
 */
export function eligibilityFromText(text: string): Eligibility {
  const out: Eligibility = {
    visas: [],
    visaSponsorship: null,
    employment: [],
    employmentExcluded: [],
    evidence: [],
  };
  const add = <T extends string>(list: T[], v: T) =>
    list.includes(v) ? false : (list.push(v), true);
  const note = (field: Evidence["field"], value: string, s: string) =>
    out.evidence.push({
      field,
      value,
      quote: quote(s),
      method: "text-pattern",
      sourceField: "description",
    });
  for (const s of eligibilitySentences(text)) {
    if (s.length > 600) continue;
    const negative = NEGATION.test(s);
    const visaContext =
      /\b(visas?|immigration|work authori[sz]ation|H-?1-?B|OPT|TN status|(employer|employment|future) sponsorship|sponsorship for employment)\b/i.test(
        s,
      ) && !/\bexport licen[cs]e/i.test(s);
    // "not able to sponsor for every role" is a hedge, not a statement about this posting.
    const hedged =
      /\b(every|all|some|certain)\s+(roles?|candidates?|positions?|cases?)\b/i.test(
        s,
      );
    if (visaContext && !hedged && /\bsponsor(ship|ing|s|ed)?\b/i.test(s)) {
      if (negative && !/\bnot required\b/i.test(s)) {
        if (out.visaSponsorship !== "not_offered")
          note("visaSponsorship", "not_offered", s);
        out.visaSponsorship = "not_offered";
      } else if (!negative && SPONSOR_OFFERED.test(s)) {
        if (!out.visaSponsorship) {
          out.visaSponsorship = "offered";
          note("visaSponsorship", "offered", s);
        }
        if (/\bH-?1-?B\b/i.test(s) && add(out.visas, "H1B"))
          note("visas", "H1B", s);
      }
    }
    if (
      !negative &&
      /\b(accept(s|ing)?|welcome[sd]?|eligible|consider(ed)?|open to)\b/i.test(
        s,
      )
    ) {
      if (/\bSTEM[\s-]OPT\b/.test(s) && add(out.visas, "STEM OPT"))
        note("visas", "STEM OPT", s);
      if (
        /(?<!STEM[\s-])\bOPT\b/.test(s) &&
        /\b(candidates?|students?|holders?|visa|work authori[sz]ation|F-?1)\b/i.test(
          s,
        ) &&
        add(out.visas, "OPT")
      )
        note("visas", "OPT", s);
    }
    for (const [strict, mention, value] of ENGAGEMENT) {
      if (negative && mention.test(s)) {
        if (add(out.employmentExcluded, value))
          note("employmentExcluded", value, s);
      } else if (!negative && strict.test(s) && add(out.employment, value))
        note("employment", value, s);
    }
  }
  // A posting that says both "W2" and "no W2" in different sentences is contradictory: keep neither.
  out.employment = out.employment.filter(
    (v) => !out.employmentExcluded.includes(v),
  );
  if (out.visaSponsorship === "not_offered") out.visas = [];
  out.evidence = out.evidence.filter(
    (e) =>
      (e.field !== "visaSponsorship" || e.value === out.visaSponsorship) &&
      (e.field !== "employment" ||
        out.employment.includes(e.value as EmploymentOption)) &&
      (e.field !== "visas" || out.visas.includes(e.value as VisaOption)),
  );
  return out;
}
