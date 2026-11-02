# SpaceJobs.Now — bounded TEST candidate

Verified 2026-11-02. Implemented only for experimental, read-only validation. No production activation, database writes, accounts, provider contact, Docker or commits.

## Public feed and reuse basis

[Publisher feed documentation](https://spacejobs.now/job-feed) explicitly invites boards, apps and newsletters to republish full employer descriptions. Every listing and Apply action must retain the feed's `url`; pay must stay unchanged. No account, key, logo or credit is required. The implementation still supplies `SpaceJobs.Now` attribution linked to that listing.

[General terms](https://spacejobs.now/legal/terms) restrict automation except where expressly permitted and contain broad competing-product language. This implementation relies specifically on the publisher's public job-board feed permission, not permission to scrape unrelated pages or repurpose other site data.

The feed documents 600 rows per page, one to a few polls daily, page requests spaced several seconds apart and a one-to-two-minute wait after 503. `date` mixes employer publication with provider first-seen dates; no provenance marker distinguishes them. Therefore every normalized `postedAt` remains null. `updated` is retained only as `sourceUpdatedAt`.

## Measured sample and full-text checks

Ordinary unauthenticated GET of `https://spacejobs.now/feeds/jobs.xml?country=us&page=1` returned HTTP 200, 5,763,149 bytes and 600 rows. Header reported 15,046 total jobs across 26 pages. Only page 1 was fetched; this is not a complete corpus.

Two sample descriptions were compared with original employer public Greenhouse data after resolving the provider detail page's JSON-LD identifier:

| Provider reference | Original employer identity | Comparison |
| --- | --- | --- |
| `2570d7e745f1` | [SpaceX 8927312002](https://boards-api.greenhouse.io/v1/boards/spacex/jobs/8927312002) | Feed HTML 4,511 characters; decoded plain text 4,153 vs original 4,158. Differences were five heading colons; no missing words. |
| `d266fc0ccc70` | [Astranis 4607847006](https://boards-api.greenhouse.io/v1/boards/astranis/jobs/4607847006) | Feed HTML 5,249 characters; both plain texts 4,874. Difference was em dash converted to hyphen. |

The matched original application identities were `https://boards.greenhouse.io/spacex/jobs/8927312002?gh_jid=8927312002` and `https://job-boards.greenhouse.io/astranis/jobs/4607847006`. Their original timestamps matched feed dates exactly, but those two matches do not establish provenance for all other dates. ApplySmooth retains the required SpaceJobs backlink instead of replacing it with employer URLs. The first Intuitive Machines sample's direct employer page was not independently verified; it is not counted as a successful original comparison.

## Exact integration contract

- Source: `spacejobs`; tenant: `public`.
- `sourceJobId`: unchanged `referencenumber`, exactly 12 lowercase hexadecimal characters. No fabricated employer requisition ID.
- Both URLs equal the untouched feed URL, for example `https://spacejobs.now/jobs/sr-security-engineer-infrastructure-2570d7e745f1?utm_source=job-feed&utm_medium=job-feed&utm_campaign=us`.
- Raw URL must use exact HTTPS host `spacejobs.now`, a lowercase alphanumeric/hyphen slug ending in the same reference, and exactly `?utm_source=job-feed&utm_medium=job-feed&utm_campaign=us`. All 600 cached URLs use this query. Explicit ports, credentials, encoded or traversing paths, alternate query order/values, extra parameters and fragments fail closed.
- Attribution: `SpaceJobs.Now`, exact same listing URL.
- Original description is converted to plain text without truncation. Unrelated metadata is stripped. Missing title/company/description reaches existing gates as missing data.
- Structured country and hiring reach are checked together. Explicit exclusions, conflicting location/country, incomplete restricted eligibility and talent pools are quarantined through `UnverifiedPostingError`. The US feed filter alone never supplies eligibility.
- Unknown publication dates stay null; update dates never substitute. Only an explicit source deadline supplies expiry.
- A zero-pay placeholder stays verbatim in the description. Invalid derived numeric salary is omitted through `SalarySchema` validation.

## Bounds and validation

One observation page, maximum 600 jobs, 20 MB response limit, 30-second request timeout, at most two requests. A transient failure waits 60 seconds before the single retry. Redirects are rejected. Malformed XML, DTD/entities, duplicate IDs, unexpected page metadata or unsafe identities fail the board. Absence never proves closure; full pagination remains unimplemented.

Cached response replay through shared `validateTargets` and `prepareBoard`:

| Measurement | Count |
| --- | ---: |
| Fetched | 600 |
| Quality accepted before within-board deduplication | 597 |
| Accepted catalog rows | 595 |
| Within-board duplicates rejected | 2 |
| Country/location conflicts quarantined | 3 |
| Accepted with unknown original publication date | 595 |
| Accepted with proven publication within 15 days | 0 |
| Database writes / additional live requests during replay | 0 / 0 |

Three conflicting public references: `2a5bc0e0536e`, `565d2d83a8d9`, `fec01e4022ff`. They are retained as discovered identities and never published. Duplicate counts are not cross-source deduplication or incremental new-job estimates.

Evidence: `/tmp/jobplatform-spacejobs.xml`, `/tmp/spacejobs-sample-SpaceX.xml`, `/tmp/spacejobs-original-SpaceX.json`, `/tmp/spacejobs-sample-Astranis.xml`, `/tmp/spacejobs-original-Astranis.json`. Final replay report: `/tmp/50-source-spacejobs-final.json`; accepted rows: `/tmp/50-source-spacejobs-accepted.jsonl`.

Fourteen focused tests cover full-text retention, dates, required fields, remote reach, contradictory eligibility, expiry, zero salary, typed quarantine, exact URLs, malformed XML, duplicates, page bounds and retries. Collector TypeScript check passed. Cloud TEST execution, backend contract validation, application-link verification and production promotion remain separate checks.
