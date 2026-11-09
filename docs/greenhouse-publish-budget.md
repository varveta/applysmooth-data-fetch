# Greenhouse publication budget

Read-only backend logs for runs [42521220460](https://github.com/varveta/applysmooth-data-fetch/actions/runs/42521220460) and [42474261516](https://github.com/varveta/applysmooth-data-fetch/actions/runs/42474261516) showed SQLSTATE 57014 statement timeouts during catalog expiry/last-seen updates. The database request role has an eight-second statement budget. Concurrent index write pressure was also observed. This was not evidence of a malformed job or deterministic constraint failure.

Greenhouse now uses five-row/50 KB target batches and processes one board at a time, including in mixed manual runs. A legitimate single row can still exceed the target up to the existing 900 KB protocol limit. Other source-only runs keep their existing 25-row/250 KB targets and concurrency. The existing shared workflow timeout, API rate limit, board leases, run completion, and retry identities remain unchanged. More small requests may encounter 429; the client continues honoring bounded Retry-After.

The backend error-contract change must deploy to TEST **before** this client change. Retryable responses are 408, 429, 503, and a 504 with the fixed JSON error `database_timeout`. Network/timeout exceptions remain retryable. Generic 500/502/504 and invalid-value/integrity 422 responses stop immediately instead of resending the same body four times. Unknown server errors are not relabeled as invalid input.

Synthetic tests cover batch limits, complete-board counts, identical retry payloads, serialization, and error handling. They do not prove production recovery or reproduce exact GIN contention. A controlled live run must complete for both Toast and Anduril before Greenhouse is re-enabled. No new sources or schedule increases are part of this mitigation. Remote First Jobs PR #21 remains on hold.

Use the manual-only **Greenhouse recovery** workflow on `main` for that controlled run, leaving **Jobs - greenhouse** disabled. It defaults to `dry-run`; an explicitly selected `publish` invokes the existing source runner for Greenhouse only, retaining its activation checks, TEST environment, repository/branch guards, and shared writer queue. It has no schedule. Inspect the saved source summary and verify both Toast and Anduril completed before restoring the regular workflow.

If reverting the backend timeout response to generic 502, revert this stricter client policy first. Keep the smaller publication budget or pause Greenhouse while investigating a regression.

## Recovery observation

[Recovery run 42566844409](https://github.com/varveta/applysmooth-data-fetch/actions/runs/42566844409) completed 21 of 22 boards, including Toast and Anduril. Asana acknowledged all 21 accepted jobs, but its final completion request received HTTP 500. Accessible Vercel request logs and Supabase collector error logs did not identify the cause. This is not evidence that the original database timeouts recurred, nor justification to retry every HTTP 500.

The manual recovery workflow now offers `board: asana` to recover only that configured board after its existing lease expires. It uses a fresh run and current upstream snapshot, not a reconstructed completion payload for the failed run. The runner rejects partial selection outside a manual Greenhouse/Asana run, and normal workflows continue processing every configured board. Keep the scheduled workflow paused until the targeted recovery succeeds. Never alter database leases to accelerate recovery.
