# Delta publication

Default off. Requires the matching backend migration, guarded API release and explicit pilot approval. No database migration or live delta activation has occurred in this change.

`JOBS_COLLECTOR_DELTA_BOARDS` is a comma-separated list of existing `source:tenant` identities, read from the GitHub `test` environment variable by the shared source runner. Start empty. It controls optimization only; existing active-source, repository, branch, environment and backend board permissions still apply. Enable a board only when the actual pinned backend advertises delta version 1 for its complete identity snapshot.

Normalization, quality gates, identity resolution, deduplication and link verification still precede comparison. Matching eligible fingerprints use compact `mark_seen_batch` observations; new, changed, null, ineligible or unsupported fingerprints use full publication. Every operation shares one contiguous batch-number space and the unchanged completion envelope.

Full and compact batches retain current transaction budgets (Greenhouse five rows/50 KB target; others 25/250 KB), including full-row fallback preflight. Atomic stale-fingerprint 409 refreshes identity history once before full fallback at that uncommitted number. Unknown conflicts fail closed. Transport retries resend identical bytes, including after a lost acknowledgment. Generic HTTP 500 is not made retryable.

Backend owns the canonical publication schema and SHA-256 helper. `src/lib/jobs-collector/publication-contract.ts`, its test and the v1 golden fixture must remain synchronized with ApplySmooth. Changes to fingerprint meaning require a version bump and a normal full re-upload. first_seen_at is excluded; source dates, ownership, aliases, attribution and all prepared publication fields are included. Existing content_hash remains unchanged.

Local tests compare an unchanged fixture in full and delta modes with matching outcomes and >=90% fewer total request-body bytes. Database parity/expiry/replay tests live in the backend PR. The live two-run pilot and three days of Vercel usage remain required after approval; no billing savings are claimed yet.

Counters include full_rows/compact_rows per board, payload_bytes for every attempt, requests, retries, timeouts, successful decoded response_json_bytes and HTTP p95 latency. Decoded JSON bytes exclude headers, compression and failed responses. HTTP latency is not pure database transaction latency; correlate backend RPC timings with database timeout logs.

Rollback: clear the collector variable first, let in-flight retries/leases drain, then disable backend advertisement or restore its previous immutable endpoint. Keep additive schema and acknowledgments. Continue daily schedules; do not merge PR #21 or restore higher frequencies until measurements and owner approval permit it.
