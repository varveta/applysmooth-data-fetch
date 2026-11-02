# Teamtailor public RSS — experimental collector

Checked 2026-11-02. The [official RSS guide](https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide) documents public job feeds for sending data to other systems and promotion channels. It lists descriptions, publication dates, global IDs, locations and remote status, and documents `offset` / `per_page`. This collector uses those public employer feeds. The separate keyed API and partner integrations are not used.

## Real-board evidence

- Working employer: Varnish Software, tenant `varnish-software`.
- Feed: https://varnish-software.teamtailor.com/jobs.rss?offset=0&per_page=100
- Read-only sample: 4 jobs, 39,409 bytes; 2 explicitly US, both dated within 15 days. Remaining rows list non-US countries; one is older than 60 days.
- Full-text check: RSS description for https://varnish-software.teamtailor.com/jobs/8634398-account-executive-us-varnish-software-supply-chain is 7,421 characters and exactly equals that public page's JobPosting JSON-LD description. No detail-page enrichment is needed during collection.
- Same listing's RSS GUID is `67b6bd68-edaf-47a7-95bf-7548ca31a589`; original RSS date `Thu, 29 Oct 2026 09:41:42 +0100` normalizes to `2026-10-29T08:41:42.000Z`. The page JSON-LD supplies only day precision, so RSS time is retained.
- Second attempted real board, `tixtrack.teamtailor.com/jobs.rss`, returned 404 and was dropped.

## Contract and limits

Source `teamtailor`; employer tenant matches `/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/`. Only `https://{tenant}.teamtailor.com` is supported. Custom domains and regional subdomains such as `.na.teamtailor.com` need separate validation before support.

`sourceJobId` is the RSS UUID GUID, normalized to lowercase. It is intentionally distinct from the numeric ID in the provider URL. Source and application URL are the exact feed job link, with path matching `/^\/jobs\/[1-9]\d{0,19}-[a-z0-9]+(?:-[a-z0-9]+)*\/?$/`; query strings, fragments, credentials, ports and cross-tenant hosts are rejected. Per-job attribution is `{ name: "Teamtailor", url: sourceUrl }`. Feed channel title supplies the employer. Explicit `tt:country` determines country; employer/client mentions, city names and generic remote status do not establish US eligibility.

Full description HTML is converted to text without truncation. Missing dates remain null; invalid stated dates fail. [Provider remote-status definitions](https://partner.teamtailor.com/job_boards/) support `hybrid`, `fully` and `none`; temporary/unknown status remains unspecified.

Loader requests 100 jobs/page, up to 10 pages, one second between pages, two HTTP attempts, 20-second timeout and 12 MB/page. Redirects are rejected. XML must validate; DTDs/custom entity declarations, wrong channel/namespace, repeated GUIDs or numeric URL IDs, malformed pages and failures abort the snapshot. A full final page marks the window capped. The feed is observation-only: absence never closes a job, including valid empty windows.

## Validation status

`pnpm exec vitest run src/lib/jobs-ingest/teamtailor.test.ts`: **8 tests passed**. `pnpm typecheck`: passed. Regressions cover complete descriptions/date precision, explicit country evidence, unknown dates, oversized content, unsafe XML/URLs, duplicate GUIDs and numeric IDs, capped pagination and failed partial snapshots.

Live loader at `2026-11-02T20:24:08.358Z`: **4 fetched, 2 accepted, 2 rejected, 0 quarantined**. Both accepted rows are explicitly US and within 15 days; 3 rows overall are within 15 days; 0 unknown dates. Rejections: 2 non-US, including 1 older than 60 days. Accepted plain-text descriptions retain 5,326 and 5,257 characters. One HTTP attempt, 39,409 bytes, one uncapped observation page. Local evidence: `/tmp/teamtailor-adapter-evidence.json`.

No local Docker, accounts, database writes or production changes were used. Cloud TEST, isolated Supabase and publication/visibility checks remain parent integration work.
