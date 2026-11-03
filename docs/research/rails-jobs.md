# Rails Job Board / JobKit

Reviewed November 2, 2026. Experimental source `railsjobs`, tenant `public`.
Count the JobKit platform once if additional JobKit boards are integrated later.

## Public access and reuse evidence

The [JobKit platform](https://www.jobkit.io/) explicitly describes its RSS feed as
usable by feed readers, aggregators and automations. Its own live example is the
Rails Job Board. The [Rails Foundation launch announcement](https://rubyonrails.org/2023/11/27/rails-job-board-is-live)
identifies JobKit as the platform and invites RSS subscription. The
[current board](https://jobs.rubyonrails.org/) directly links its
[public RSS endpoint](https://jobs.rubyonrails.org/jobs.rss).

Together these primary sources support a scoped feed-based aggregation proposal.
This is not a claim of ownership or unrestricted resale rights over employer
content. No separate mandatory credit wording or published polling allowance was
found in these pages. ApplySmooth should visibly credit `Rails Job Board` per
listing and retain the canonical provider link as the source, application and
credit destination. Use a conservative daily refresh initially. Do not infer
permission to copy unrelated JobKit materials or collect applicant data.

The [JobKit REST API documentation](https://docs.jobkit.io/introduction) describes
account integrations with authentication. This implementation uses the public RSS
feed only; it needs no account, API key, employer-page scraping or detail hydration.

## Implemented contract

- Adapter `railsjobs`; loader `loadRailsJobsBoard`.
- Fixed endpoint `https://jobs.rubyonrails.org/jobs.rss`, one request window,
  bounded retries, 20-second timeout, 12 MB response ceiling, redirects rejected.
- Strict RSS 2.0 envelope and channel identity; reject malformed XML, DTD/entity
  declarations, duplicate numeric identities and mismatched GUID/link pairs.
- `guid` equals the canonical provider `link`. Numeric identity is extracted
  from `/jobs/{positive-id}-{lowercase-hyphen-slug}`; a slug edit does not create
  a new job. Credentials, explicit ports, query, fragment, percent escapes and
  foreign hosts fail validation. No trailing slash was observed or allowed.
- Full feed HTML becomes readable plain text, preserving paragraphs and bullets.
  Original `pubDate` becomes ISO time; missing/invalid dates fail rather than
  receiving discovery time. Extra feed fields are stripped by Zod.
- RSS title ends with ` at {employer}`. Final delimiter separates role and
  company; missing employer fails normalization.
- The feed has no structured location field. Only affirmative role/hiring
  statements and explicit `Location:` lines provide geography. Evidence records
  text-pattern extraction from the description. Generic remote, North America,
  company/client locations, reporting locations, negative and conflicting
  statements do not establish US eligibility.
- Discovery is always `observations`, `capped: true`, `maximum_jobs: 1000`.
  This is a provider-selected RSS window, not a complete employer inventory.
  Empty feeds and absent jobs never authorize closure.

## Read-only measured sample

One local HTTP 200 fetch returned 77,274 bytes and 12 listings. Raw full HTML
descriptions ranged from 2,364 to 7,875 characters. At
`2026-11-02T20:45:07.412Z`, cached-feed validation accepted 7, rejected 1 non-US
listing and quarantined 4 with unknown US eligibility. Two original posting dates
were within 15 days; one of those was accepted. No unknown dates or DB writes.

Temporary artifacts: `/tmp/50-source-railsjobs-report.json` and
`/tmp/50-source-railsjobs-accepted.jsonl` (7 normalized accepted rows). Full feed
and descriptions remain temporary, not repository fixtures.

Six focused tests passed: content/date/identity/credit preservation, conservative
geography, missing dates/length gate, invalid envelopes/duplicates/entities,
unsafe destinations, bounded fetching and observation-only empty/error handling.
Hosted TEST access, isolated backend acceptance and approved production rollout
remain separate verification steps. Local read-only success is not live ingestion.
