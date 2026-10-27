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

The manual `Collector` workflow supports `rehearsal`, legacy `publish`, and `stateless` on `main`.
**Owner-approved stateless scheduling is enabled after live ingestion and maintenance validation.**
Cadence: `17 4,10,16,22 * * *` (04:17, 10:17, 16:17, 22:17 UTC; every six hours).
GitHub may delay scheduled runs; these are target start times.

### Pipeline 1: stateless fetch

Select `stateless` to run `ingest/stateless.ts`. It requires only `COLLECTOR_ENDPOINT`,
`COLLECTOR_TOKEN`, and optional `COLLECTOR_VERCEL_BYPASS` in the `test` environment.
It does not restore or save a cache, acquire an archive lease, or open SQLite. The old
`publish` mode remains available with its existing secrets and archive behavior.

Each invocation generates one UUID. Each complete board is normalized, deduplicated within
that board using backend identity history, and filtered using the existing quality gates. Invalid source identities,
normalization failures, conflicting duplicate identities, or an explicit total mismatch
report `board_fetch_failed` without publishing or completing that board. Valid rejected
jobs still count toward `fetched_count`. Empty valid boards complete with zero batches;
the backend owns zero-result and large-drop withdrawal guards.

Accepted rows are split into serialized UTF-8 requests of at most 900,000 bytes, including
the envelope. Retried requests preserve the exact body and batch number. Every row must be
acknowledged exactly once before `complete_board`; HTTP 409 stops immediately. Other boards
may finish after a board fails, but the workflow fails overall. A workflow rerun has a new
UUID; backend upserts must preserve original first-seen and publication dates across runs.
Stateless first_seen_at is this run's observation time for new rows, never authority to
replace an existing backend date. No cross-source matching or historical ledger is inferred.

JSON logs separate fetch, publish and completion stages. The final summary reports request
counts (including retries), collector payload bytes (including retries), source response
bytes from successful fetches, and processing duration. GitHub job duration/billed minutes
must be read from the actual Actions run; local timing is not billing evidence.

Only the legacy and stateless publisher jobs share `collector-online` concurrency while
both modes exist, so comparison runs cannot interleave writes. CI and rehearsal do not
enter that queue; a push to main cannot displace a pending publication run. The publishers
use `queue: max` with `cancel-in-progress: false` (up to 100 pending jobs; further arrivals
are canceled if that queue is full). The schedule targets stateless mode. Daily verification runs at 06:47 UTC; lifecycle runs at
08:37 UTC with a dry-run gate and deletion disabled. The activation record is in
`docs/rollout-2026-10-27.md`. Acceptance checklist used before activation:

- Deploy the matching backend operations and preserve the main-only TEST environment policy.
- Merge and manually run `stateless` on `main`; verify no cache/archive steps execute.
- Compare with legacy `publish` on TEST. Legacy uses historical canonical identities,
  expiry state and a 40-live-row cap; stateless sends every currently accepted row to the
  backend. Explain any count/identity differences before accepting the replacement.
- Verify retries preserve dates, failed snapshots cause no withdrawals, and missing jobs
  require two successful runs with zero-result/large-drop guards enforced by the backend.
- Record job duration, billed minutes, requests and payload bytes in the PR. Verify a
  main-branch failure email reaches the designated account address.
- Enable schedules through the owner-authorized rollout change.

Pre-review validation (2026-10-26): 51 tests and typechecking passed. A public fetch-only probe of
`ashby:openai` fetched 794 postings, accepted 313, and rejected 481 in 6.56 seconds. It made
one source request (13,883,942 response bytes), prepared four batches totaling 2,886,448
bytes, and had a largest batch of 895,522 bytes. No collector endpoint was called. These
measurements do not establish TEST publishing acceptance or GitHub billed minutes.

#### Required identity snapshot contract (added after review)

Before publishing a fetched board, the collector requests the server's complete identity
history. The backend implementation of pipeline 1 must add this read-only operation:

```jsonc
{ "operation": "board_identities", "run_id": "uuid", "source": "greenhouse", "tenant": "example" }
// Response:
{ "source": "greenhouse", "tenant": "example", "complete": true, "identities": [
  { "id": "existing public catalog ID", "source_job_id": "5",
    "first_seen_at": "2026-10-23T12:00:00Z", "duplicate_posting_ids": ["greenhouse:example:3"] }
] }
```

The snapshot must include published, withdrawn, archived and tombstoned identity anchors,
not just the current live rows. The backend must retain the original source posting key,
first-seen date and all known duplicate member aliases even after content deletion. Seed
this metadata from the legacy publication ledger before migration; an unknown/incomplete
history must not be returned as a successful empty snapshot. Validate the collector token
and board allowlist as for publication. `publish_batch` must persist alias metadata even
when content is unchanged, and must independently preserve existing publication/expiry dates.
Stateless rows additionally carry `observed_source_job_id`: the current source posting used
for the content and apply link. `source_job_id` remains the original canonical key. The
backend must validate and persist this observed reference with each batch, and `verify_queue`
must return it as the source ID to check, while keeping `id` as the canonical catalog ID.
Otherwise a surviving sibling could be withdrawn merely because its original anchor closed.
This metadata extension is stateless-only; legacy publication requests remain compatible.

An existing anchor wins over a newly discovered lower-ID sibling. Known sibling aliases
retain the same catalog ID and first-seen date even if the original posting leaves the
board. Historical ownership takes priority over current duplicate matching:

- If two established identities look like duplicates now, publish both under their existing
  IDs. Do not merge their dates, aliases or locations. Quarantine only new unanchored members
  whose ownership cannot be determined.
- If one identity's aliases split into distinct current groups, publish one eligible
  representative under the existing ID. Prefer the eligible original posting, then a
  known eligible alias, then a newly attached candidate; order ties deterministically by
  posting ID. Keep known aliases, but merge locations and adopt new
  aliases only from that representative's own current duplicate group.
- Other eligible members of an unselected split branch are quarantined. The board still
  publishes unrelated jobs and completes normally. Fetch logs include `identity_resolution`
  counts for splits, merges and quarantined postings so the ambiguity remains visible.

If the original is absent and surviving aliases have diverged into distinct roles, the
snapshot has no previous observed ID/content to identify the preferred role. The deterministic
fallback is reported as a split for review; it does not infer that those roles are equivalent.
Malformed snapshots or overlapping historical alias ownership still fail the board. Those
are invalid history, unlike ordinary changes in current duplicate matching.
Unknown new siblings with no shared source identity or recorded alias cannot be inferred
from this contract; requisition-based historical matching is a separate backend extension.
Missing/invalid/unsupported snapshot responses fail the board before any batch or completion.
This is a required backend integration change; the collector does not assume it is deployed.

### Pipeline 2: verification

After pipeline 1 and the matching backend are deployed, run the manual **Verify jobs**
workflow on `main`. It uses the same three endpoint secrets and TEST restrictions, with
concurrency group `verify`. The prepared `47 6 * * *` schedule remains commented out.
`VERIFY_LIMIT` defaults to 500 and can lower the cap (1–500); the backend owns queue priority,
age eligibility, withdrawal policy and consecutive-failure counters.

`ingest/verify.ts` checks Greenhouse/Lever individual posting endpoints, then the apply link
only when the source confirms the posting. It reads each Ashby board once per tenant and
validates all posting identities before treating absence as closed. Ashby's documented
[public API](https://developers.ashbyhq.com/docs/public-job-posting-api) exposes the board
list; its [individual-posting API](https://developers.ashbyhq.com/reference/jobpostinginfo)
requires `jobsRead` permission, so this collector uses the public list method.

Requests share global concurrency 8 and per-host concurrency 4, including every redirect
destination. Static board pools and dynamic verification use the same scheduler. Source
checks have a 15-second timeout and one attempt; transient failures report uncertain for
the next daily run. Apply checks use GET, a 15-second timeout per admitted request, and at
most five redirects. Waiting for a host slot does not consume network timeout. Generic
careers/login redirects (including `job-boards.greenhouse.io`), access denial, timeouts, transient
DNS resolution errors and invalid responses are uncertain. Source-confirmed jobs with
404/410 apply links or definitive DNS name-not-found errors are link_broken. Only definitive
source evidence reports closed; an unavailable or empty Ashby board never closes all its
jobs. `verify_queue` may include `boards[]` entries with `source`, `tenant`, and a safe,
nonnegative integer `last_complete_fetched_count`. When an Ashby snapshot contains fewer
than half that count of unique posting IDs, absent jobs report uncertain with
`Source board dropped over 50%; closure withheld`. Exactly half remains valid absence
evidence. Present jobs still proceed to their apply-link checks on a truncated board.

Without matching board metadata, verification keeps the existing empty-board guard and
the lower bound from the tenant's distinct queued source IDs. That queue guard also stays
in force when a supplied prior count is zero. Duplicate board entries or malformed counts
fail the queue before source requests or result submission. Queue size remains a
conservative lower bound; persistent uncertainty stays available for manual review.

Results contain only ID, classification, optional HTTP status and a short reason. No content
is rewritten. Results are sent in batches of 100 and each acknowledgment must record the
full batch. Backend retries must be idempotent on run ID and job ID so a retried result does
not advance consecutive-failure counters twice. Result events contain stage, board, job
ID, classification and detail. Error-shaped events are reserved for failures;
the final summary records classifications, jobs checked, requests, payload bytes and duration.

Local validation: verification tests use offline synthetic API fixtures matching each
source's response shape. They cover open/closed/transient errors, apply-link failures,
redirect limits, concurrent Ashby board sharing, prior board counts and the 50% boundary,
metadata validation, and per-host/global pacing. No live calls
run in CI. Pending acceptance: seed known open/closed jobs in TEST, confirm classifications
and backend counters, and record Actions job duration and billed minutes in the PR.

### Pipeline 3: lifecycle

Run the manual **Job lifecycle** workflow on `main`. The `apply` input defaults to false.
`ingest/lifecycle.ts` always requests and logs a dry run first. Counts above 5,000 archives
or 1,000 deletions fail before any apply call. `LIFECYCLE_ARCHIVE_LIMIT` and
`LIFECYCLE_DELETE_LIMIT` can configure those limits. An explicit `apply=true` performs one
apply request after the dry-run gate and logs actual counts. Apply requests are not retried
automatically because this endpoint contract has no idempotency key; inspect backend state
after an ambiguous failure, then start a new dry run.

The collector never changes `delete_after_archive_days`: unset remains deletion disabled.
The backend owns expiry, archival, deletion and tombstones. A response with deletion
disabled and nonzero deleted count is invalid. Archive/delete limits gate the dry-run result;
transactional enforcement and any changes between preview and apply belong to the backend.

The workflow uses the same TEST secrets and main-only restriction, concurrency group
`lifecycle`, and a commented `37 8 * * *` schedule. Scheduled runs would apply after the
dry-run gate once explicitly enabled. Pending TEST acceptance: compare dry counts with the
database, apply to known expired jobs, verify archived content remains stored and hidden
from users, verify deleted=0/delete_enabled=false while retention is unset, and record
Actions duration and billed minutes. Scheduling and deletion remain separate decisions.

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

### Reporting split-off postings

`complete_board` includes `quarantined_posting_ids` (up to 500 full posting keys, for example `greenhouse:example:123`) and `quarantined_count` (the full count). These identify postings set aside because historical duplicate ownership conflicts with today's grouping. Ordinary duplicate copies and jobs rejected by quality gates are excluded. Both fields are sent together, including an empty array and zero when no identity conflict exists.

Deploy endpoint support before this collector change. The endpoint may release a persistent split-off alias after four trusted complete runs; the next identity snapshot then allows that posting to become a separate job. Original IDs and first-seen dates remain stable. The collector does not release ownership itself or enable schedules.
