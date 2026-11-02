# Account-free OSS collector integration

Implementation review (2026-11-02): reuse selected public collection methods inside the existing
Node/TypeScript collector. Do not run four parallel foreign ingestion stacks or
import their prefiltered datasets. The working prototype requires no job-provider
account, registration, API key, paid proxy, or AI service.

## Run the solution

From this repository with Node 24 and pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm preview:sources ingest/config/free-source-preview.json ingest/config/preview-filters.json
```

The manifest initially covers Pinpoint/Group O and Breezy/Embraer + SUBSCRIBE.
Add employer targets only for an implemented adapter; unknown sources fail before
HTTP. These independently discovered employer pages supplied the Breezy targets:
https://embraer.breezy.hr/ and https://subscribe.breezy.hr/.

Outputs under gitignored `ingest/data/preview/`:

- `accepted.jsonl`: complete normalized descriptions and metadata passing current
  ApplySmooth gates and within-board duplicate handling, before preference filters.
- `selected.jsonl`: accepted rows matching your editable preferences.
- `report.json`: source success/failure, fetched/accepted/rejected/quarantined
  counts, gate reasons, requests and bytes. Failure returns a nonzero exit code;
  successful peer boards remain available for local inspection.

Edit the filter JSON, then re-filter without fetching anything:

```sh
pnpm refilter:sources ingest/config/preview-filters.json
```

Example filter configuration:

```json
{
  "title_any": ["engineer", "analyst"],
  "description_any": ["SQL", "Python"],
  "exclude_any": ["commission-only"],
  "work_modes": [],
  "job_types": ["Full-time", "Contract"]
}
```

Terms use case-insensitive literal substring matching. Entries within a list use
OR; different filters use AND. `exclude_any` searches title and description.
Empty lists add no restriction. Unknown work mode/type does not satisfy an
explicit selection. Existing US, freshness, description and safety gates still
run first. Offline filtering does not refresh source status or recover jobs
already rejected by these gates. `selection-report.json` describes the latest
offline selection; the original fetch report retains its original filters/time.

## What was checked in the OSS repositories

| Repository and inspected commit | Concrete finding | Integration choice |
|---|---|---|
| datascry/openroles `26672b376114e61fdf9f17ad63624c8bce598e5a` | Bun/TS adapters; Breezy public `/json`; several adapters truncate descriptions to 4,000 characters; listing dataset is separately CC BY-SA | Adapt public fetch methods, preserve full details, use our gates. MIT notice retained. No dataset import. |
| Riley-Dorrington/job-board-aggregator `247c1a2584c79b9af32281cc5b50c7d881d29f11` | Python collectors; inspected Greenhouse output omits full description; curated company datasets separately CC BY-NC | Reference MIT collector code only. Do not import company datasets or use its output as full job records. |
| fedorchenko-juli/job_search_tool `1a09901abfd47ee168515be97399ea8294caa7c2` | Python ATS clients and local filters; direct sources overlap our adapters; Adzuna and AI introduce credentials | Use configurable local-filter approach. No additional runtime or paid services. |
| speedyapply/JobSpy `68b88d6909a2342ad75fbb945c4204a3a7ed6665` | Python package; LinkedIn guest scraping and Indeed GraphQL; proxy-aware clients, per-board blocking; descriptions can need extra requests | Not a dependency for this prototype. No claim its advertised boards pass our access/reliability or full-description requirements. |

## Implemented flow

Public list -> validate identities/URLs -> public detail pages when needed ->
full-description normalization -> existing ApplySmooth gates and within-board
identity/deduplication -> optional preference filters -> local JSONL and count reports.

Breezy listing data often lacks descriptions. Its loader follows each same-tenant
posting URL and uses matching JobPosting JSON-LD, or the older HTML description container
with matching canonical and application links. No 4,000
character truncation. Missing details, malformed responses, duplicate IDs or failed
requests fail the board instead of manufacturing a successful empty snapshot.
Listing size is bounded at 500 postings. Detail reads are sequential, one attempt
per URL, with time/byte caps. No proxy or credential fallback is attempted.

Original page publication dates take precedence over listing refresh dates.
Source-expired postings fail existing gates. Unknown dates remain unknown.
Snapshots use observations semantics and cannot prove closure through absence.
No cross-source or historical database deduplication is claimed by this preview.

The existing TEST workflow automatically discovers the added source in
`expansion-test.json`, runs offline tests/typecheck, then runs independent cloud
fetch/validation jobs. It uploads count-only reports, never the local descriptions.
`preview:sources` itself is a local review command, not a scheduled writer.

## Release boundary

Pinpoint and Breezy are experimental sources and cannot enter the stateless
publisher, even if added to activation configuration. Verification reports them
uncertain. This preserves the user's earlier TEST-first / decide-PROD-later scope.

Before actual catalog publishing, implement and test matching backend source and
attribution contracts, identity/closure behavior, isolated preview acceptance,
and source-specific reuse conditions. Fetching without login proves technical
access, not a blanket license to republish employer descriptions. Neither stars
nor an MIT code license establishes data rights. No 50-source completion claim.

## Live probe limitations

JobScore public feeds for Unified, AeroShield and MAQ Software returned HTTP 403
in this environment. No bypass attempted; excluded from the working manifest.
Initial Cabin and Embraer probes exposed pages without JSON-LD. An older-template
HTML parser was added and regression-tested; missing/ambiguous pages still fail
the board. A later Embraer run encountered a timeout and was not counted as success.
SUBSCRIBE is retained as a useful real freshness test: six old jobs rejected.

## Verified local result — November 2, 2026

At 14:58 UTC, the complete preview succeeded in 34.8 seconds:

| Board | Fetched | Accepted | Rejected | Requests |
|---|---:|---:|---:|---:|
| Pinpoint / Group O | 14 | 14 | 0 | 1 |
| Breezy / Embraer | 65 | 44 | 21 | 66 |
| Breezy / SUBSCRIBE | 6 | 0 | 6 | 7 |
| Total | 85 | 58 | 27 | 74 |

All 27 rejections were `posting_too_old`. Zero quarantined rows. Full local
accepted/selected exports contain 58 rows with the default unrestricted preference
filters. Zero database writes. Offline re-filtering was also exercised.
All 341 offline tests, TypeScript checks and diff whitespace checks passed.
Counts change with source postings; this is not proof of catalog ingestion.
