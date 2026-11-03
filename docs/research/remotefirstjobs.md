# RemoteFirstJobs / formerly JobsCollider

Reviewed 2026-11-02. One distinct platform; absent from the 83-entry tracker when checked. **Adapter locally verified in an isolated copy, publication/date conditions unresolved; not production-ready.**

## Official interface and display conditions

- [Public API documentation](https://remotefirstjobs.com/jobs-api): keyless `GET https://remotefirstjobs.com/api/search-jobs`, optional `query`, `category`, and `page=0..4`; at most 100 records/page, 500/query. Listings are delayed 24 hours. Fields include employer, full HTML description, provider URL, locations, and publication timestamp.
- [RSS documentation](https://remotefirstjobs.com/rss) expressly invites use in job boards and aggregators. `https://remotefirstjobs.com/rss/jobs/software-development.rss` supplies the latest 100 matching listings, refreshed every ten minutes. Credit Remote First Jobs and link back. Both API and feed conditions prohibit onward submission to LinkedIn Jobs, Google Jobs, Jooble, or similar services.
- [General terms](https://remotefirstjobs.com/terms) contain a broad restriction on copying/distribution without permission. The specifically documented public-feed display invitation supports bounded research and potential own-board display, but this is **not** a settled commercial publication/indexing decision. ApplySmooth must avoid prohibited onward syndication and check whether its public structured data/indexing paths would submit these records to Google Jobs before rollout. Keep publication approval separate from technical TEST acceptance.

## Bounded live evidence

One API request to `https://remotefirstjobs.com/api/search-jobs?category=software-development&page=0` returned HTTP 200, 906,046 bytes, 100 distinct IDs; 43 contain the explicit location `United States`. HTML descriptions span 2,077–13,160 characters (US subset 4,688–13,160). All 100 have a `published_at`, but **none has a timezone**. Their dates range October 30–November 1, 2026. These are sample observations, not normalized accepted counts or historically unique jobs.

One documented RSS request returned HTTP 200, 907,756 bytes, 100 entries with complete-looking descriptions of 3,065–15,107 characters. RSS exposes title/company combined, provider URL, GUID, and timezone-bearing pubDate, but no dedicated location field. API is therefore the simpler reliable US classification surface. Neither bounded window can prove closure by absence.

Sample: `staff-software-engineer-ios-subscription-growth-878336`, employer MyFitnessPal, location United States, [provider posting](https://remotefirstjobs.com/companies/myfitnesspal/jobs/staff-software-engineer-ios-subscription-growth-878336). API has duties, qualifications, benefits, compensation, and equal-opportunity ending; public indexed detail includes the same sections. A direct detail request returned 403; no bypass or alternate access was attempted. Full original-employer byte/content parity remains unverified.

## Date and implementation recommendation

The sample API timestamp is `2026-11-01T05:24:11`; its provider page labels November 1 as **Updated**. [Methodology](https://remotefirstjobs.com/methodology) describes collecting and normalizing employer postings but does not establish that API `published_at` is the employer's original publication time. RSS pubDate cannot resolve that provenance. **Do not assign either to original `postedAt` or infer freshness. Use null until supported. Current proven-fresh count: zero.**

TEST contract: source `remotefirstjobs`, tenant `public`, API slug ID ending in digits, maximum 120 characters to match the shared contract. Exact HTTPS provider URL pattern `/companies/{company-slug}/jobs/{job-id}`; preserve this as source/apply URL and per-job attribution (`Remote First Jobs`). The API documents the **full slug** as its identifier, and observed RSS GUIDs also use the full slug. No documentation establishes numeric-suffix stability; do not invent a numeric canonical ID. Identity stability across title/slug changes is unproven. No direct employer application URL is exposed by the sampled API. Retain full HTML, actual `company_name`, explicit US country only, strict ID/URL consistency, bounded paging/response size/retries, duplicate-page failure, and observation-only lifecycle. Do not close records missing from a rolling window.

## Local TEST preparation

Implemented isolated `src/lib/jobs-ingest/remotefirstjobs.ts`, its focused test, and `ingest/lib/fetch-remotefirstjobs.ts`. Loader defaults to one software-development API page; configurable maximum five pages, 100 jobs/page, serial one-second pacing, two bounded HTTP attempts, 20-second timeout, 4 MB/page budget, and redirects rejected. A wrong page number, incorrect count, malformed record, duplicate ID, or failed later page aborts the entire observation. Full descriptions are converted to safe plain text without clipping; oversized descriptions remain subject to the shared quality gate. No detail hydration requests are made.

Initial nine focused regressions and collector typecheck passed in a disposable copy. Subsequently integrated the experimental source ID, adapter registry, loader dispatch, and expansion TEST manifest in the collector. Existing generic observation verification already handles this source; four additional verification regressions prove the TEST guard, absence/failure uncertainty, source/link confirmation, and changed-URL/eligibility handling. **Full collector suite: 487 tests across 36 files passed; typecheck passed.** No production source configuration or workflow was changed.

Cached live-response replay through `validateTargets` produced: **100 fetched, 43 accepted, 31 rejected (non-US), 26 quarantined (unknown eligibility), zero within-board duplicates; 100 unknown original dates, zero proven fresh**. This is local TEST preparation with an empty identity snapshot, not cloud ingestion or historically unique yield.

Cached evidence: `/tmp/50-source-remotefirstjobs-probe.json`, `/tmp/50-source-remotefirstjobs-rss.xml`, `/tmp/50-source-remotefirstjobs-validation.json`, and 43 prepared catalog rows in `/tmp/50-source-remotefirstjobs-accepted.jsonl`. Replay used no additional HTTP. No cloud tests, database writes, commits, or production changes were performed.
