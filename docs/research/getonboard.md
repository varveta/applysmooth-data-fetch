# Get on Board — experimental source

Status: adapter and bounded public fetcher implemented; not enabled in production.
One platform, tenant `public`. No account, API key, registration, or payment used.

## Access and reuse

[Official public-API guidance](https://www.getonbrd.com/help/what-can-i-do-with-get-on-board-s-api)
explicitly permits displaying published jobs externally and building custom job
boards with public listings. Public access needs no setup. The separate private
API covers employer/candidate operations and is not used.
The [official Ruby SDK](https://github.com/getonbrd/getonbrd-ruby) documents public
job/company resources. Its linked technical documentation returned an access
error during earlier review; no authentication or access restriction was bypassed.

Fetch URL:
`https://www.getonbrd.com/api/v0/search/jobs?query=United%20States&page=1&per_page=10&expand%5B%5D=company`

The search query is discovery only. It also matches US client/employer mentions
and does not establish applicant geography. Only explicit job `countries` values
set country eligibility; numeric unresolved city/region references are not guessed.
Generic remote jobs stay unknown. Company headquarters never establish US access.

## Implementation contract

- `getonboard` source, `public` tenant, original job slug as source ID.
- Source and application URL are exactly
  `https://www.getonbrd.com/jobs/{source_job_id}` (optional trailing slash).
  No foreign host, port, credentials, query, fragment or different job path.
- Display credit: `Get on Board`; attribution links to the same job page. This
  preserves the provider application path and visible source link.
- Company name comes from the expanded company object, not the configured label.
- Keep all job-specific description, projects, functions, desirable qualifications,
  and benefits sections plus their source headings. Convert HTML with the existing
  deterministic text converter. Do not substitute company-profile text or snippets.
- Preserve `published_at` seconds as the original UTC timestamp. Null stays null.
  No fetch date or source-created fallback. Currency-less numeric salary and
  unexplained reference IDs remain unknown; explicit description salary uses the
  existing extractor.
- At most 25 pages of 10 jobs. Sequential page requests wait one second; each has
  two attempts, a 20-second timeout and a 12 MB response cap. Reject changed page
  metadata, short intermediate pages, duplicate IDs, failed or malformed pages.
- The response is always an observation window. A capped window is marked as such;
  missing jobs never establish closure. No source activation, writer or schedule.

## Measured November 2, 2026

Read-only adapter run at `2026-11-02T20:12:58.962Z`:

| Measure | Count |
| --- | ---: |
| Fetched source IDs | 29 |
| Accepted | 1 |
| Rejected | 14 |
| Quarantined | 14 |
| Explicit US eligible | 1 |
| Original dates within 15 days | 7 |
| Accepted within 15 days | 1 |
| Unknown dates | 0 |
| Requests / pages | 3 |
| Database writes | 0 |

Rejection/quarantine reasons overlap: 25 unknown-US, 3 non-US, 13 older than the
60-day ingestion cutoff. These are current search-window counts with empty
identity history, not a full provider inventory or proof of incremental yield
against production. Accepted record is the current Devsu Senior Account Manager
posting with an explicit US country. No fetched descriptions or incidental
application/company metadata are stored in this repository.

Seven focused tests cover full-content/date preservation, attribution, US
eligibility, unknown dates, oversized-description gating, pagination/caps,
malformed/failed/duplicate pages, empty observations and source URL scope.
Root integration must still supply the shared adapter wiring, backend contracts,
write-free TEST and isolated acceptance evidence before production review.
