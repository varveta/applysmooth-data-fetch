# AI Dev Jobs — description truncation blocks integration

Reviewed 2026-11-02. Distinct platform `aidevboard.com`; no adapter or shared source registration added.

## Access and permitted use

[Official documentation](https://aidevboard.com/docs) publishes unauthenticated REST reads. [Terms section 6](https://aidevboard.com/terms) permits API data in applications, excluding resale as a standalone dataset. Public reads are free with hourly abuse throttles; an optional key is unnecessary for these probes. [OpenAPI YAML](https://aidevboard.com/openapi.yaml) documents up to 50 results/page, page numbers, location filtering and `posted_within_days` (1–90). The JSON-spec URL returned 301; the directly documented YAML succeeded without following that redirect.

## Bounded live evidence

- `https://aidevboard.com/api/v1/jobs?location=United%20States&limit=3`: 3 rows, reported total 264, exact total, `degraded=false`, `estimated=false`.
- Same query with `limit=50`: 50 rows, 296,229 bytes. All 50 original publication dates are older than 15 days; newest `2026-10-06T18:39:27Z`. Forty-eight descriptions have lengths between 4,900 and 4,999 characters, a strong truncation signal.
- `https://aidevboard.com/api/v1/jobs?location=United%20States&posted_within_days=15&limit=3`: HTTP 200, 1,118 bytes, **zero exact matches**, `degraded=false`, `estimated=false`. The empty response uses `jobs:null`, a schema detail a future loader must handle deliberately. This measures the literal location filter, not every possible US city spelling.
- Detail: `https://aidevboard.com/api/v1/jobs/074ea5ff-c6b6-449e-9c6e-56c3323c5341`.
- Corresponding provider page: `https://aidevboard.com/job/074ea5ff-c6b6-449e-9c6e-56c3323c5341`.
- Original employer record: `https://boards-api.greenhouse.io/v1/boards/elastic/jobs/8247144`.

The sampled Elastic Lead Data Engineer description is **4,965 plain-text characters** in both list/detail APIs and provider-page JobPosting JSON-LD. It ends mid-word. The original employer description is **7,687 plain-text characters** and continues through benefits, accommodations and employment conditions. Provider-page enrichment therefore cannot recover complete text. Do not import these snippets or silently replace them with generated content.

For this row, API `published_at=2026-10-06T18:39:27Z` exactly represents employer `first_published=2026-10-06T14:39:27-04:00`. API `created_at` is October 14. Provider-page `datePosted` incorrectly uses October 14, so that page date must not replace the employer date. This is a verified sample, not proof that every API publication date is original.

Stable API UUID, employer company name, provider link, external apply URL and explicit `location=United States` exist. The detail response's provider URL changes from UUID to slug; future contracts must choose one stable provider form intentionally. Application-action metadata is unrelated to collection and must not be executed or persisted.

## Decision

Blocked on complete descriptions, with weak recent US inventory in the sampled window. Follow-up requires an officially supported untruncated export or a separately reviewed employer-detail hydration plan. Local evidence `/tmp/newsource-aidevjobs-*`; no accounts, outreach, Docker, database writes or production changes.
