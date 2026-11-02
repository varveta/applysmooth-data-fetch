# Read-only writer readiness diagnostic

This manual-only diagnostic checks the existing writer without publishing jobs,
activating sources, fetching providers or reading back secret values. It is
separate from the source-expansion TEST work. Creating this workflow does not run
it; there are no schedule, push or pull-request triggers.

The existing GitHub `test` environment permits only `main`. A reviewed merge to
`main` is required before a manual run; keep that protection unchanged. Both the
workflow and script refuse another repository, branch or event. Existing secrets
are supplied only to the diagnostic step. No new credentials or environment
changes are needed.

The script compares the endpoint internally with the verified TEST Preview alias
and prints only `endpoint_matches_verified_TEST_alias`. A mismatch stops all
requests. Runtime active sources and their configured targets must match the
audited 49 boards exactly; configuration drift also stops all requests.

It then sends up to 49 serial `board_identities` requests with `posting_ids: []`,
waiting one second between requests. The current HTTP contract requires a UUID,
but this operation does not create a run or acquire a lease. Scoped identity SQL
checks the board's initialized/reconciled history and returns an empty array.
The HTTP route checks the exact board allowlist before invoking that read.
The request timeout is 10 seconds; response limit is 8 KiB; redirects are refused.
There are no retries. Any failed status or invalid response stops remaining reads.

Output contains only known board names, HTTP status, booleans and counts. A returned
identity count of zero means the **requested scope was empty**, not that the board
has no jobs. Responses, headers, exception details and credentials are never
printed or uploaded. No artifact or checkpoint is produced.

| Source | Configured boards |
| --- | ---: |
| Ashby | 10 |
| Greenhouse | 22 |
| Lever | 5 |
| SmartRecruiters | 2 |
| Workable | 2 |
| Personio | 1 |
| Recruitee | 2 |
| Jobicy | 1 |
| Himalayas | 1 |
| We Work Remotely | 1 |
| Remote OK | 1 |
| Remotive | 1 |
| **Total** | **49** |

Exact reviewed board names live in `AUDITED_BOARDS` in
`ingest/writer-readiness.ts`. On November 2, 2026, read-only database checks found
these same 49 persisted scopes, all identity-ready, and no extra catalog or
tombstone scopes. Hosted `job_collector_scoped_identities` matched the repository
definition; it performs reads only. Recheck those facts when interpreting a run.

A successful result proves endpoint binding and coverage for these configured
boards. It does not reveal the sensitive environment value or prove that no
additional unused allowlist entries exist. The diagnostic does not exercise
publication, provider access, new-source seeds, verification or lifecycle writes.

There are no Supabase catalog, identity, run, lease or storage mutations. Normal
HTTP/Actions logging and rate-limit counters may still change. Legacy checkpoint
restore is deliberately not used: acquiring its lease and downloading its archive
can update state, prune storage or reserve download budget. Verification queues
and lifecycle dry-runs are also excluded because they write audit/lease records.

After review and merge, the separate authorized manual invocation is:

```sh
gh workflow run writer-readiness.yml --repo varveta/applysmooth-data-fetch --ref main
```

No workflow execution is part of this draft PR. Unit tests use mocked responses,
injected waits and synthetic credentials; no network or local Docker is required.

Validation before opening the draft: 27 diagnostic tests passed; the complete
collector suite passed 343 tests across 21 files, and TypeScript checking passed.
