# ApplySmooth data fetch

Standalone, deterministic public ATS collector. Node.js 24 and pnpm 10.32.1.
Application code, database credentials, archives, and original source payloads are excluded.
Fixtures committed here are synthetic. No AI calls.

```sh
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm rehearsal
```

`rehearsal` fetches the configured public boards, normalizes, deduplicates, and quality-filters
into a disposable local SQLite database. It makes **no catalog writes**. It prints counts only.
The pilot configuration contains one Ashby board; Greenhouse and Lever adapters are included.

## Online publishing

The manual `Collector` workflow supports `rehearsal` and `publish` on `main`.
**Scheduling stays disabled until cloud monitoring drills and email delivery pass.**
Prepared cadence: `17 4,10,16,22 * * *` (04:17, 10:17, 16:17, 22:17 UTC; every six hours).
GitHub may delay scheduled runs; these are target start times.

Create the `test` GitHub environment restricted to `main`, then set these environment secrets:

- `COLLECTOR_ENDPOINT`: TEST backend URL ending in `/api/jobs-collector`.
- `COLLECTOR_TOKEN`: random collector-only credential; never a Supabase key.
- `COLLECTOR_VERCEL_BYPASS`: Vercel automation access when preview protection requires it.
- `COLLECTOR_CACHE_KEY`: a random 32-byte AES key, base64 encoded.
- `SENTRY_CRON_URL`: ingestion-only URL for the dedicated collector monitor.

Only default-branch manual/scheduled jobs may publish. PR jobs run tests without secrets.
The backend independently validates credentials, board allowlists, batch sizes, identities,
URLs, operations, release settings, and a database-backed lease. It exposes no general SQL,
table reads, or arbitrary RPC dispatch. Keep environment branch restrictions enabled.

## Durable history and recovery

The private backend stores compressed SQLite checkpoints in a private object-storage bucket.
Chunks are content-addressed, capped at 16 MB, and verified by SHA-256 during restore.
SQLite integrity and required tables are checked before use. Missing or corrupt state stops
the run; it never creates an empty publication history. Bootstrap is an operator-only action
using the existing archive and publication ledger.

A database lease excludes concurrent publishers. Manifest updates compare generation numbers.
The backend retains the previous manifest and removes unreferenced chunks older than one hour
on acquisition. The runner saves a pending plan before publishing, then checkpoints its
acknowledged ledger. An interrupted run replays that exact plan before fetching new source data.
RPC retries preserve existing publication and expiry dates. Only an authenticated AES-256-GCM encrypted copy may enter GitHub cache.
Plaintext archives never enter cache, artifacts, releases, or Git history.
The cache is optional acceleration: SHA-256 and byte length must match the private backend
manifest, then SQLite integrity must pass. Missing, corrupt, or stale cache falls back to
the private checkpoint; it never resets history. Cache keys are unique per workflow attempt.

The initial measured archive is 300.9 MB raw / 132.3 MB gzip. Four uncached restores daily would exceed the free transfer allowance. Verified cache hits
download zero archive bytes from private storage. Two retained snapshots use about
264.7 MB; uploads and short-lived orphan chunks require additional headroom. The backend caps
bucket inventory at 800 MB; each compressed snapshot is capped at 180 MB. Check actual account
usage before enabling a schedule: advertised free quotas are shared with the application.

## Operations

- **Rerun:** rerun the manual publish job after the previous run finishes. A crashed runner's
  lease lasts 45 minutes; the workflow timeout is 30 minutes. Do not clear a live lease.
- **Corruption:** stop publishing. An operator verifies all chunks of the retained previous
  manifest and reconciles its pending plan/ledger with the catalog before restoring the pointer.
  Do not silently fall back or reset generation/history.
- **Failed upload:** the authoritative manifest stays unchanged. Retry after checking quota;
  unreferenced uploads are eligible for later cleanup.
- **Rotation:** pause publishing, replace the backend token and GitHub environment secret,
  verify old credentials fail and new credentials work, then resume. Rotate Vercel access
  separately without disabling deployment protection.
- **Disable:** disable the workflow in GitHub Actions and set backend `JOBS_COLLECTOR_ENABLED=false`.
- **Monitoring:** backend records last successful fetch/publish separately. Its authenticated
  `/state` health endpoint becomes unhealthy at 24 hours. Sentry checks the six-hour schedule with a 10-minute grace and 30-minute runtime limit.
  A separate database watchdog evaluates elapsed freshness every five minutes, independent
  of Actions, with a 24-hour threshold (delivery adds processing time). Both must pass tests
  before activation. A healthy fetch with no new jobs still counts as a refresh.
  A successful check-in follows the final durable checkpoint, never merely a successful fetch.

GitHub schedules can be delayed or dropped during high load; public-repository schedules can
be disabled after 60 days without repository activity. Keep the external monitor active.
See [GitHub scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[Supabase storage limits](https://supabase.com/docs/guides/storage/uploads/file-limits), and
[Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

## Free-resource safeguards

Use standard public-repository Linux runners. Keep GitHub cache at its included 10 GB
limit; do not enable paid cache expansion or larger runners. Supabase remains Free.
The backend limits signed checkpoint downloads to an estimated 1 GB per calendar month
and bucket inventory to 800 MB. Exhaustion fails closed and requires operator attention,
not an automatic upgrade. Other application traffic shares the provider quotas.
Sentry uses the one included Cron Monitor; the existing website uptime monitor is unchanged.
No local daemon, laptop cron, or Codex recurring automation is needed.

Email activation is deliberately separate: verify the recipient in Sentry, route this
organization's notification email to it, test actual delivery, then enable the prepared
schedule and dedicated alert. A Sentry-accepted check-in alone is not proof of email delivery.
