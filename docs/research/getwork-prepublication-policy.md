# Getwork prepublication verification

November 2, 2026. TEST implementation only; no source activation or production
writes. This policy addresses the observed distinction between quality acceptance
and a usable application: the cloud sample had 20 quality-accepted jobs, with 18
open application links, one HTTP 403 and one redirect to a generic careers page.
Those historical counts are not a measurement of the new policy.

## Shared admission rule

`prepareBoardForPublication` is the online entry point used by stateless publishing,
TEST validation/preview exports and source dry-runs. It applies additional checks
only to Getwork. Four-argument `prepareBoard` stays synchronous, pure and suitable
for offline quality/identity rehearsal; its rows are not proof of online admission.
The existing twelve production platforms retain their preparation behavior.

After complete fetch, identity validation and normalization, each quality-eligible
Getwork copy passes the existing `verifier().check`: the provider detail must still
confirm its identity, application URL and US eligibility, and the safe application
checker must confirm an open destination. Only `open` at `verify_link` admits a
copy. `uncertain`, `closed` and `link_broken` are publication quarantines; this stage
does not perform withdrawals or report lifecycle closure to the backend. Malformed
source/history data or an incomplete/broken checker fails the board before batches.

Checks precede duplicate representative selection. All discovered IDs remain in
the normalized board, identity-history lookup and fetched count. Failed copies
enter `quarantined_posting_ids`; a verified known alias may represent its existing
canonical catalog ID. First-seen dates and original posting dates retain existing
semantics. Valid alias ownership remains intact, including absent historical
aliases; unverified copies contribute no locations or other content to the row.

## Request and lifecycle bounds

The existing Getwork loader remains capped at 20 by default, maximum 50. Admission
refuses more than 50 normalized candidates and uses concurrency three / two per
application host, in addition to the verifier's HTTP limiter. The existing checker
uses one source attempt and one GET per application redirect hop, at most five
redirects, with a 15-second timeout per request. HTTP 403 and generic careers/login
redirects remain non-open; no bypass or extra retry is introduced.

One invocation caches each exact `(source, tenant, observed source ID, apply URL)`
check, including non-open results. Preview uses the same cache; it cannot retry a
blocked link to turn the run green. Changing the URL or observed identity requires
a separate check. Cache evidence is never persisted or reused by a later run.

Getwork remains an observation-only backend board. `complete_board` retains the
full fetched/quarantine counts and IDs while publishing only admitted rows.
Existing `partial_snapshot` handling prevents missing-run increments, false
absence closure and quarantine-driven alias release. Previously published blocked
rows are not renewed by this run, but this gate does not itself withdraw them.
The policy must not be extended to full-snapshot sources without separately
designing their lifecycle and identity-quarantine behavior.

## Diagnostics and verification

Reports retain pre-deduplication quality counts plus a distinct `prepublication`
report: candidates, checked, open, quarantined, request count, outcomes and reason
counts. `all_candidates_verified` remains false when any copy is quarantined.
Verification quarantines are subtracted from the duplicate count rather than
mislabelled as duplicates. `onAccepted` and preview JSONL contain admitted rows
only. A preview with no admitted rows remains unsuccessful. A successful partial
preview means its admitted subset passed; it does not claim every source candidate
was open or that production is ready.

Focused synthetic tests cover real safe-checker HTTP 403/generic redirects, exact
request reuse, historical alias fallback, excluded unverified content, fatal bad
identity/history, duplicate/count accounting, all-quarantined failure, unchanged
legacy sources and the live batching path with simulated approved activation.
All tests inject fetch/checker responses; no live provider, local Docker or database
is used. A future cloud run must measure the admitted count; 18 is an expectation
from the previous 20-row sample, not a claimed result.
