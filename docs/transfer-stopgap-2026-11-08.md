# Collector transfer stop-gap — November 8, 2026

Seven multi-daily source workflows are reduced to one run per day. All times below are UTC; GitHub may delay scheduled starts.

| Source | Previous cron | New cron |
|---|---|---|
| Ashby | `17 4,10,16,22 * * *` | `17 4 * * *` |
| Greenhouse | `27 4,10,16,22 * * *` | `27 10 * * *` |
| Lever | `37 4,10,16,22 * * *` | `37 12 * * *` |
| Personio | `27 5,17 * * *` | `27 14 * * *` |
| Recruitee | `37 5,17 * * *` | `37 16 * * *` |
| SmartRecruiters | `7 5,17 * * *` | `7 18 * * *` |
| Workable | `17 5,17 * * *` | `17 20 * * *` |

The seven changed workflows occupy distinct hours and preserve their minute offsets. Existing daily source workflows, verification, and lifecycle schedules are unchanged. The canonical `schedule_utc` configuration and source documentation match the YAML.

The original Collector workflow retains its existing cron. The live `JOBS_ACTIVE_SOURCES` variable includes `ashby`; its stateless scheduled publisher is therefore skipped. Its CI job can still execute. Do not remove `ashby` from activation without reviewing this four-times-daily fallback.

## Greenhouse pause safety: conditional request needs correction

A paused source does not run `complete_board`, so pause alone does not perform absence-based withdrawal. However, current `job_catalog_publish` renews `expires_at` when jobs are re-seen. Jobs stop receiving that renewal when collection is paused, and lifecycle/read filters still enforce time-based expiry. Successful link verification does not replace publication renewal.

Read-only live checks at 2026-11-09 04:48 UTC found `visibility_days=15`, permanent deletion disabled, and no currently visible Greenhouse job expiring in the next three days. The earliest visible Greenhouse expiry was 2026-11-22 23:03 UTC. Thus a short pause has headroom, but it is false that jobs can never expire while paused. Separate owner acceptance is needed before applying the originally conditional pause. The workflow's enabled/disabled status is an external GitHub setting, not encoded by this cron change.

Evidence: backend TEST migration `20261028140000_job_catalog_renew_on_reseen.sql`, existing lifecycle and reader logic, and live aggregate queries. No database writes were made for this audit.

## Watchdog audit

`job_collector_is_fresh` checks one global fetch timestamp and one global publish timestamp against a strict 24-hour threshold. It does not check each source independently. The live `job_collector_watch_freshness` wrapper reads the singleton `job_collector_state`.

Live state at audit:

- `job_collector_watchdog.live.enabled=false`.
- `applysmooth-collector-freshness` cron exists at `*/5 * * * *`, but `active=false`.
- Global fetch/publish timestamps remain October 26; the freshness predicate already returns false despite successful stateless source runs.

Therefore the dormant watchdog will not send new false alarms from this schedule reduction. It also does not currently provide active freshness protection. Enabling it unchanged would encounter stale legacy timestamps; threshold changes alone would not repair that integration. In an integrated once-daily system, cron delay can cross a strict 24-hour boundary, while a global timestamp can hide individual source failures. No monitor flags, schedules, functions, or thresholds were changed.

## Validation and observation

Local Node 24 validation: 563 tests passed; typecheck passed; diff whitespace check passed. Hosted CI must pass before merge.

After merge, observe scheduled runs for 24 hours and Vercel daily Fast Origin Transfer for two complete days. Target: at most 0.15 GB/day. The measurement is pending; neither this PR nor successful CI proves the transfer target or future run success. Preserve source outcome counts and failure details. PR #21 remains held; no new sources or increased schedules are authorized by this change.
