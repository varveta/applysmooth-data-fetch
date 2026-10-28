# Independent job sources

Tracking issue: https://github.com/varveta/applysmooth-data-fetch/issues/13

Each source has its own workflow, failure status, JSON validation report and schedule. All catalog writers retain the existing serialized queue. One failed source does not cancel other sources. Configuration contains 44 employer boards and five shared discovery feeds.

| Source | UTC schedule | Coverage and lifecycle |
|---|---|---|
| Ashby | 04:17, 10:17, 16:17, 22:17 | 10 employer boards |
| Greenhouse | 04:27, 10:27, 16:27, 22:27 | 22 employer boards |
| Lever | 04:37, 10:37, 16:37, 22:37 | 5 employer boards |
| SmartRecruiters | 05:07, 17:07 | Expeditors and Socotec; every page and detail must validate |
| Workable | 05:17, 17:17 | ESG USA and Jacobian |
| Personio | 05:27, 17:27 | Aily Labs employer-enabled XML; current US examples are older than the freshness limit |
| Recruitee | 05:37, 17:37 | Natuvion and Framestore; careers token required from February 10, 2027 |
| Jobicy | 05:47 | US discovery, maximum 10 pages; rolling seven-day feed. Dedicated status API verifies older stored jobs |
| Himalayas | 05:57 | US discovery, maximum 10 pages; country and timezone restrictions retained |
| We Work Remotely | 06:07 | Public RSS; explicit country restrictions take precedence over broad region labels |
| Remote OK | 06:17 | Public API; blank/unspecified remote geography is not US eligibility |
| Remotive | 06:27 | Public API; 24-hour upstream delay; advised maximum four requests/day including manual validation |

GitHub schedules can start late. They run on GitHub infrastructure. Codex monitoring uses the local desktop app and is separate from collection.

## Validation and activation

`pnpm exec tsx ingest/source-pipeline.ts <source>` defaults to a live-feed dry run: fetch, normalize, validate, deduplicate and count without any catalog writes. Reports are saved under `ingest/data/source-<source>.json`; workflows retain them for seven days.

Optional repository variable `JOBS_SOURCE_NOT_BEFORE` maps source IDs to UTC timestamps. Early runs emit a cooldown report without fetching or writing; expired entries no longer block runs. This preserves provider polling budgets during initial validation.

Set repository variable `JOBS_ACTIVE_SOURCES` to a JSON array of individually validated source IDs. Scheduled `auto` runs publish only those IDs. Unactivated sources run without writes. An explicit `publish` dispatch fails if the source is not activated. Publication also requires the trusted main-branch runner context, authenticated preview collector, exact server allowlist and completed identity import.

The original Collector schedule remains a fallback while `ashby` is inactive. Once activated, its scheduled OpenAI write is skipped to avoid duplicate collection. Verification and lifecycle workflows remain separate. Daily verification drains up to 20 batches of 500 due jobs, sharing each provider feed response across the whole sweep. The backend enforces a 24-hour retry cooldown; repeated IDs or capacity exhaustion fail visibly. Do not enable the legacy stateful publisher for expanded sources.

Before activation, deploy the additive backend migration and provider-credit UI, configure every exact source/tenant, seed identity history, verify anonymous writes remain denied, and review the per-source dry run. Preserve all historical IDs and dates. A successful dry run or green CI alone does not prove Supabase ingestion.

## Data integrity and provider conditions

New boards use server-owned `observation_only` policy by default. Only certified complete snapshots may use absence-based closure. Bounded discovery, empty feeds, transient errors and missing listings must never withdraw jobs. Explicit provider closing times cap visibility and never extend the original window. Every response and page must validate before publication starts.

Attribution is visible on search cards and job details with a normal provider backlink. Preserve source and application URLs; no copied logos. Remotive jobs remain publicly readable without signup. Remotive and Himalayas listings must not be syndicated onward or emitted as Google Jobs/JobPosting structured data. SEO is outside this rollout.

Discovery feeds can overlap employer-direct sources. Stable source identities prevent duplicates within a board and replay; cross-provider employer/requisition consolidation is not yet automatic. Do not silently merge different employers or jobs based on matching titles.

Recruitee's February 2027 authentication deadline requires employer tokens or approved partner feeds before then. Authentication failure stops that board; it must never cause endpoint guessing or bypass scraping.

Sources needing credentials, partner approval or commercial rights remain listed in issue #13. A public careers endpoint establishes technical access, not an unlimited redistribution license.
