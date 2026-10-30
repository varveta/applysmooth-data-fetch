import { pinpoint } from "./pinpoint";
import { z } from "zod";
import { ATS_ADAPTERS } from "./ats-adapters";
import { FEED_ADAPTERS } from "./feed-adapters";
import { buildJob } from "./build";
import type {
  Evidence,
  JobLocation,
  NormalizedJob,
  Salary,
  SourceId,
} from "./contract";
import { NormalizedJobSchema } from "./contract";
import {
  formatSalaryText,
  jobTypeFromStructured,
  periodFromInterval,
  plausibleSalary,
  salaryFromText,
  workModeFromStructured,
} from "./extract";
import {
  countryFromField,
  hasAmbiguousCountryLocation,
  parseLocationText,
} from "./location";
import { cleanText, htmlToText, quote, toIso } from "./text";

/**
 * Source adapters. Each one: the listing URL for a tenant, a strict envelope
 * parser (throws when the listing is not a complete snapshot), the posting ID,
 * and a pure normalizer. Fetching/retries live in `ingest/`.
 */
export type SourceAdapter = {
  source: SourceId;
  listUrl(tenant: string): string;
  /** Throws if the body is not a complete, well-formed listing. */
  parseListing(body: unknown): unknown[];
  postingId(raw: unknown): string;
  normalize(raw: unknown, tenant: string, companyName?: string): NormalizedJob;
  attribution(tenant: string): { name: string; url: string };
};

// Validate the same identity bounds before snapshot reconciliation as normalization.
// Do not trim valid source IDs: changing their bytes would create different postings.
const id = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(NormalizedJobSchema.shape.sourceJobId)
  .refine((value) => value.trim().length > 0, "Posting ID must not be blank");

// ---------------------------------------------------------------- Greenhouse
const GreenhouseJob = z.object({
  id,
  internal_job_id: z.number().nullish(),
  title: z.string(),
  absolute_url: z.string(),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  offices: z
    .array(
      z.object({ name: z.string().nullish(), location: z.string().nullish() }),
    )
    .nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
  metadata: z
    .array(z.object({ name: z.string().nullish(), value: z.unknown() }))
    .nullish(),
  pay_input_ranges: z
    .array(
      z.object({
        min_cents: z.number().nullish(),
        max_cents: z.number().nullish(),
        currency_type: z.string().nullish(),
        title: z.string().nullish(),
      }),
    )
    .nullish(),
  content: z.string().nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
});

function metadataValues(
  meta: z.infer<typeof GreenhouseJob>["metadata"],
  name: RegExp,
): string[] {
  const out: string[] = [];
  for (const m of meta ?? []) {
    if (!m.name || !name.test(m.name)) continue;
    const vals = Array.isArray(m.value) ? m.value : [m.value];
    for (const v of vals)
      if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

export const greenhouse: SourceAdapter = {
  source: "greenhouse",
  listUrl: (t) =>
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs?content=true&pay_transparency=true`,
  parseListing: (body) =>
    z.object({ jobs: z.array(z.unknown()) }).parse(body).jobs,
  postingId: (raw) => id.parse((raw as { id: unknown }).id),
  attribution: (t) => ({
    name: "Greenhouse job board",
    url: `https://job-boards.greenhouse.io/${t}`,
  }),
  normalize(raw, tenant, companyName) {
    const j = GreenhouseJob.parse(raw);
    const rawLocation = cleanText(j.location?.name);
    const postingLocations = metadataValues(
      j.metadata,
      /^(job )?posting location|^location(s)?$/i,
    );
    const officeText = (j.offices ?? [])
      .map((o) => o.location || o.name || "")
      .filter(Boolean);
    const locations: JobLocation[] = [
      ...parseLocationText(rawLocation),
      ...postingLocations.flatMap(parseLocationText),
    ];
    // Office names ("US Locations", "Remote - United States") are employer-stated. Use them
    // only to add explicit countries, never to replace a stated location.
    const officeCountries = new Set<string>();
    for (const o of officeText) {
      const prefixed = /^([A-Z]{2})-[A-Za-z]/.exec(o)?.[1]; // "IE-Dublin", "US-Remote"
      if (prefixed) officeCountries.add(prefixed === "UK" ? "GB" : prefixed);
      for (const l of parseLocationText(o))
        if (l.country) officeCountries.add(l.country);
    }
    if (officeCountries.size === 1) {
      // One employer-stated office country explains bare cities ("Chicago" under office "US").
      const country = [...officeCountries][0];
      for (const l of locations)
        if (!l.country && !hasAmbiguousCountryLocation(l.raw))
          l.country = country;
      if (!locations.length)
        locations.push({
          raw: officeText.join("; "),
          city: null,
          region: null,
          country,
          remote: false,
        });
    }
    const ranges = (j.pay_input_ranges ?? []).filter(
      (r) => r.min_cents || r.max_cents,
    );
    let salary: { salary: Salary; evidence: Evidence } | null = null;
    const currencies = new Set(ranges.map((r) => r.currency_type));
    if (ranges.length && currencies.size === 1) {
      const mins = ranges
        .map((r) => r.min_cents)
        .filter((n): n is number => !!n);
      const maxs = ranges
        .map((r) => r.max_cents)
        .filter((n): n is number => !!n);
      const currency = ranges[0].currency_type?.toUpperCase() ?? null;
      const periods = new Set(ranges.map((r) => periodFromInterval(r.title)));
      const period = periods.size === 1 ? [...periods][0] : null;
      const s: Salary = {
        min: mins.length ? Math.min(...mins) / 100 : null,
        max: maxs.length ? Math.max(...maxs) / 100 : null,
        currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
        period,
        text: "",
      };
      s.text = `${formatSalaryText(s.min, s.max, s.currency, s.period)}${ranges.length > 1 ? " (varies by location)" : ""}`;
      if (plausibleSalary(s))
        salary = {
          salary: s,
          evidence: {
            field: "salary",
            value: s.text,
            quote: quote(
              ranges.map((r) => r.title ?? "").join(" / ") ||
                "pay_input_ranges",
            ),
            method: "structured",
            sourceField: "pay_input_ranges",
          },
        };
    }
    const descriptionText = htmlToText(j.content ?? "");
    const employmentType = metadataValues(
      j.metadata,
      /employment type|job type|time type/i,
    )[0];
    return buildJob({
      source: "greenhouse",
      tenant,
      sourceJobId: String(j.id),
      requisitionKey:
        j.internal_job_id != null ? String(j.internal_job_id) : null,
      title: j.title,
      company: cleanText(j.company_name) || companyName || tenant,
      department: j.departments?.[0]?.name ?? null,
      descriptionText,
      // Employer careers page when it is HTTPS; otherwise Greenhouse's hosted application page.
      applyUrl: /^https:\/\//i.test(j.absolute_url)
        ? j.absolute_url
        : `https://job-boards.greenhouse.io/${tenant}/jobs/${j.id}`,
      sourceUrl: `https://job-boards.greenhouse.io/${tenant}/jobs/${j.id}`,
      locations,
      rawLocation: [rawLocation, ...postingLocations].join("; "),
      workMode: null,
      jobType: employmentType
        ? jobTypeFromStructured(employmentType, "metadata.employment_type")
        : null,
      salary: salary ?? salaryFromText(descriptionText),
      postedAt: toIso(j.first_published),
      sourceUpdatedAt: toIso(j.updated_at),
    });
  },
};

// ---------------------------------------------------------------- Lever
const LeverJob = z.object({
  id,
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      commitment: z.string().nullish(),
      location: z.string().nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  lists: z
    .array(
      z.object({ text: z.string().nullish(), content: z.string().nullish() }),
    )
    .nullish(),
  additional: z.string().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});

export const lever: SourceAdapter = {
  source: "lever",
  listUrl: (t) =>
    `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`,
  parseListing: (body) => z.array(z.unknown()).parse(body),
  postingId: (raw) => id.parse((raw as { id: unknown }).id),
  attribution: (t) => ({
    name: "Lever job board",
    url: `https://jobs.lever.co/${t}`,
  }),
  normalize(raw, tenant, companyName) {
    const j = LeverJob.parse(raw);
    const c = j.categories ?? {};
    const primary = cleanText(c.location);
    const all = (c.allLocations ?? []).map(cleanText).filter(Boolean);
    const structuredCountry = countryFromField(j.country);
    const locations = [primary, ...all.filter((l) => l !== primary)].flatMap(
      (text, i) =>
        parseLocationText(text).map((l) =>
          // Lever's `country` describes the primary location only.
          i === 0 && structuredCountry && !l.country
            ? { ...l, country: structuredCountry }
            : l,
        ),
    );
    if (!locations.length && structuredCountry)
      locations.push({
        raw: j.country ?? "",
        city: null,
        region: null,
        country: structuredCountry,
        remote: false,
      });
    const html = [
      j.description ?? "",
      ...(j.lists ?? []).map(
        (l) => `<h3>${l.text ?? ""}</h3><ul>${l.content ?? ""}</ul>`,
      ),
      j.additional ?? "",
    ].join("\n");
    const descriptionText = htmlToText(html);
    const r = j.salaryRange;
    let salary = null;
    if (r && (r.min || r.max)) {
      const s: Salary = {
        min: r.min ?? null,
        max: r.max ?? null,
        currency:
          r.currency && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
        period: periodFromInterval(r.interval),
        text: "",
      };
      s.text = formatSalaryText(s.min, s.max, s.currency, s.period);
      if (plausibleSalary(s))
        salary = {
          salary: s,
          evidence: {
            field: "salary" as const,
            value: s.text,
            quote: quote(JSON.stringify(r)),
            method: "structured" as const,
            sourceField: "salaryRange",
          },
        };
    }
    return buildJob({
      source: "lever",
      tenant,
      sourceJobId: String(j.id),
      requisitionKey: null,
      title: j.text,
      company: companyName || tenant,
      department: c.department ?? c.team ?? null,
      descriptionText,
      applyUrl: j.applyUrl || j.hostedUrl,
      sourceUrl: j.hostedUrl,
      locations,
      rawLocation: [primary, ...all.filter((l) => l !== primary)].join("; "),
      workMode: workModeFromStructured(j.workplaceType, "workplaceType"),
      jobType: jobTypeFromStructured(c.commitment, "categories.commitment"),
      salary: salary ?? salaryFromText(descriptionText),
      postedAt: toIso(j.createdAt),
      sourceUpdatedAt: null,
    });
  },
};

// ---------------------------------------------------------------- Ashby
const PostalAddress = z
  .object({
    postalAddress: z
      .object({
        addressLocality: z.string().nullish(),
        addressRegion: z.string().nullish(),
        addressCountry: z.string().nullish(),
      })
      .nullish(),
  })
  .nullish();
const AshbyJob = z.object({
  id,
  title: z.string(),
  department: z.string().nullish(),
  employmentType: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z
    .array(z.object({ location: z.string().nullish(), address: PostalAddress }))
    .nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  address: PostalAddress,
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  compensation: z
    .object({
      compensationTiers: z
        .array(
          z.object({
            components: z
              .array(
                z.object({
                  compensationType: z.string().nullish(),
                  interval: z.string().nullish(),
                  currencyCode: z.string().nullish(),
                  minValue: z.number().nullish(),
                  maxValue: z.number().nullish(),
                  summary: z.string().nullish(),
                }),
              )
              .nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

function ashbyLocation(
  text: string | null | undefined,
  address: z.infer<typeof PostalAddress>,
  remote: boolean,
): JobLocation[] {
  const pa = address?.postalAddress;
  const country = countryFromField(pa?.addressCountry);
  if (country)
    return [
      {
        raw:
          cleanText(text) ||
          [pa?.addressLocality, pa?.addressRegion, pa?.addressCountry]
            .filter(Boolean)
            .join(", "),
        city: cleanText(pa?.addressLocality) || null,
        region: cleanText(pa?.addressRegion) || null,
        country,
        remote: remote || /\bremote\b/i.test(text ?? ""),
      },
    ];
  return parseLocationText(text ?? "");
}

export const ashby: SourceAdapter = {
  source: "ashby",
  listUrl: (t) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}?includeCompensation=true`,
  parseListing: (body) =>
    z.object({ jobs: z.array(z.unknown()) }).parse(body).jobs,
  postingId: (raw) => id.parse((raw as { id: unknown }).id),
  attribution: (t) => ({
    name: "Ashby job board",
    url: `https://jobs.ashbyhq.com/${t}`,
  }),
  normalize(raw, tenant, companyName) {
    const j = AshbyJob.parse(raw);
    const remoteMode = j.workplaceType?.toLowerCase() === "remote";
    const locations = [
      ...ashbyLocation(j.location, j.address, remoteMode),
      ...(j.secondaryLocations ?? []).flatMap((s) =>
        ashbyLocation(s.location, s.address, remoteMode),
      ),
    ];
    const salaries = (j.compensation?.compensationTiers ?? [])
      .flatMap((t) => t.components ?? [])
      .filter(
        (c) => c.compensationType === "Salary" && (c.minValue || c.maxValue),
      );
    let salary = null;
    const currencies = new Set(salaries.map((c) => c.currencyCode));
    const periods = new Set(
      salaries.map((c) => periodFromInterval(c.interval)),
    );
    if (salaries.length && currencies.size === 1 && periods.size === 1) {
      const mins = salaries
        .map((c) => c.minValue)
        .filter((n): n is number => !!n);
      const maxs = salaries
        .map((c) => c.maxValue)
        .filter((n): n is number => !!n);
      const s: Salary = {
        min: mins.length ? Math.min(...mins) : null,
        max: maxs.length ? Math.max(...maxs) : null,
        currency:
          salaries[0].currencyCode &&
          /^[A-Z]{3}$/.test(salaries[0].currencyCode)
            ? salaries[0].currencyCode
            : null,
        period: [...periods][0],
        text: "",
      };
      s.text = `${formatSalaryText(s.min, s.max, s.currency, s.period)}${salaries.length > 1 ? " (varies by tier)" : ""}`;
      if (plausibleSalary(s))
        salary = {
          salary: s,
          evidence: {
            field: "salary" as const,
            value: s.text,
            quote: quote(salaries.map((c) => c.summary ?? "").join(" / ")),
            method: "structured" as const,
            sourceField: "compensation",
          },
        };
    }
    const descriptionText = j.descriptionHtml
      ? htmlToText(j.descriptionHtml)
      : cleanText(j.descriptionPlain);
    return buildJob({
      source: "ashby",
      tenant,
      sourceJobId: String(j.id),
      requisitionKey: null,
      title: j.title,
      company: companyName || tenant,
      department: j.department ?? null,
      descriptionText,
      applyUrl: j.applyUrl || j.jobUrl,
      sourceUrl: j.jobUrl,
      locations,
      rawLocation: [
        j.location,
        ...(j.secondaryLocations ?? []).map((s) => s.location),
      ]
        .filter(Boolean)
        .join("; "),
      workMode: workModeFromStructured(j.workplaceType, "workplaceType"),
      jobType: jobTypeFromStructured(j.employmentType, "employmentType"),
      salary: salary ?? salaryFromText(descriptionText),
      postedAt: toIso(j.publishedAt),
      sourceUpdatedAt: null,
    });
  },
};

export const ADAPTERS: Record<SourceId, SourceAdapter> = {
  greenhouse,
  lever,
  ashby,
  ...ATS_ADAPTERS,
  ...FEED_ADAPTERS,
  pinpoint,
};
