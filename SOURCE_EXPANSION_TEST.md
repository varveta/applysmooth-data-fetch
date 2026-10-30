# Expansion toward 50 platforms — TEST checkpoint

This work treats “50 sources” as 50 distinct platforms, not 50 employer boards.
Issue #13 delivered 12 platforms covering 49 employer boards/feeds. This checkpoint
adds **one experimental platform**, Pinpoint, and a separate validation workflow.
It does not claim 50 implemented sources, 50 validated integrations, or readiness
for production. Candidate research is in SOURCE_CANDIDATES.md.

## What runs in TEST

- `ingest/config/expansion-test.json` lists only experimental targets (initially
  Pinpoint / Group O). Existing production source configurations remain intact.
- `pnpm exec tsx ingest/validate-targets.ts ingest/config/expansion-test.json pinpoint`
  fetches the provider, validates and normalizes the complete response, applies
  current quality gates and deduplication, and saves a count-only JSON report.
- `source-validation-test.yml` runs tests/typecheck on TEST pushes, then independent
  source matrix jobs with `fail-fast: false`, two concurrent jobs and individual
  artifacts. Documentation-only pushes do not trigger provider requests.
- TEST fetches use no collector credentials, environment secrets, database client,
  schedule, or writer queue. Pinpoint is additionally denied by publication-mode
  resolution and the stateless writer before any request, even if activated by
  mistake. No experimental source is enabled on main.
- Reports explicitly use empty identity snapshots and do not claim live ingestion.
  Gate reasons may overlap; accepted/rejected/quarantined totals are distinct.
- Pinpoint has an additional manual TEST-only wrapper. GitHub may require workflow
  registration on the default branch before manual dispatch is available; the TEST
  push matrix is the validated cloud entry point without merging to main.

## Pinpoint behavior

Public `postings.json`, stable posting IDs, configured employer, full description
sections, explicit closing date, same-tenant HTTPS URLs, and existing US eligibility
checks. Missing publication dates stay unknown. Observation-only fetches and
unsupported closure checks cannot infer that missing jobs are closed. Conflicting
or duplicate IDs reject the snapshot. No collected descriptions are committed or
uploaded in reports.

Official documentation: https://developers.pinpointhq.com/docs/jobs-json-endpoint

Initial local validation on October 30, 2026: 14 fetched, 14 accepted, 0 rejected,
0 quarantined, 1 request, 118,818 bytes, **0 writes**. Counts are time-specific.
Local automated checks: 333 tests passed; TypeScript checks passed.
Cloud evidence is attached to the TEST workflow run, not inferred from local tests.

## Preview versus database boundary

The existing ApplySmooth Vercel preview collector writes to the shared production
Supabase project. It must not be used to publish experimental rows under TEST-only
authorization. GitHub TEST validation is cloud fetching, **not Vercel preview
contract acceptance or database ingestion**. No new Vercel backend deployment or
shared database migration is part of this checkpoint.

Before release, each new provider needs backend source/attribution contracts,
local current-schema PostgreSQL insertion and replay tests, isolated preview
acceptance, identity seeding, exact server allowlists, verified display terms, and
explicit source-specific closure behavior. A separate isolated test database or a
write-free preview contract endpoint is required for cloud backend acceptance.
These items remain pending for Pinpoint; production publishing is deliberately
blocked in code.

## Acceptance gates for every added provider

1. Supported endpoint and appropriate access; real employer feed, not demo rows.
2. Original dates/IDs, employer identity, country restrictions, safe application URL.
3. Pagination completeness or explicit bounded observation policy; partial failure,
   duplicate/cursor conflict, malformed data and oversized responses tested.
4. Fetched/accepted/quarantined/rejected reason evidence locally and in cloud TEST.
5. Rate budget shared across discovery, manual validation and verification. Remotive
   advises at most four reads/day; Jobicy permits a new automated pass at most hourly.
6. Current backend schema accepts prepared rows locally; repeated batches are
   idempotent, failed batches do not falsely complete, and absence never closes a
   bounded-feed job.
7. Preview contract, attribution/apply links, expiry and public display rules checked
   without writing to shared production data.
8. Independent workflow outcome and diagnostics; no credentials or descriptions in
   public artifacts; per-source activation requires explicit rollout approval.

## Benefits and costs

| Benefit | Tradeoff |
| --- | --- |
| More employers, sectors and specialist roles | Platform count does not guarantee fresh US-eligible jobs |
| Less dependence on one provider | More API changes, authentication expiry and failures to maintain |
| Independent source failures and targeted troubleshooting | More workflow minutes, requests, reports and monitoring |
| Employer-direct postings can improve freshness and application links | Full-detail pagination can require many requests per board |
| Multiple feeds improve discovery | Cross-provider duplicates are not automatically consolidated today |
| Source-specific adapters preserve better facts | Every provider adds geography, date, expiry and attribution cases |

Prioritize unique accepted US jobs per request and maintainable access over a
numerical target. Credentialed/paid sources need supplied access and budget choices.
Do not enable placeholder or demo pipelines merely to reach 50.
