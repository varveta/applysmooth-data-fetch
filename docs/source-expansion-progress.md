# Goal: 50 distinct live production sources

Production baseline: 12. Additional live sources: 0. Remaining production gap: 38.
Four experimental adapters are implemented; they do not count as production.
Candidate queue: `source-expansion-tracker.json` (39 candidates, including a new alternative).

## November 2 checkpoint

| Platform | Fetched | Accepted | Rejected | Quarantined | Known recent | Unknown dates | Verified links |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pinpoint | 14 | 10 | 4 | 0 | 10 | 0 | 10 |
| Breezy | 71 | 45 | 26 | 0 | 45 | 0 | 45 |
| Manatal | 2 | 1 | 0 | 1 | 0 | 2 | 1 |
| Trakstar Hire | 4 | 3 | 1 | 0 | 3 | 0 | 3 |

Counts are time-specific local samples, using empty identity history. Cross-source
unique yield remains unmeasured. Zero shared database writes. Known-recent counts
are based on original source dates; unknown dates are not evidence of freshness.
Manatal's one accepted listing still lacks a verifiable original posting date.

Pinpoint's public feed omits original dates, but matching public job pages expose
them. Fetch those pages using their UUID identity while preserving the numeric feed
ID as canonical identity. This correctly rejects four old jobs that the former
feed-only check accepted. Full descriptions and explicit expiry remain preserved.

Trakstar uses the [documented public frontend API](https://apiv1.recruiterbox.com/frontend_api.html)
for Elevate97 and Valtas Group. It validates pagination, exact tenant links, and
matching page identity/date metadata. Page templates sometimes emit raw control
characters in JSON strings; repair only those characters, never evaluate scripts.
Three recent US jobs survive the gates. One old short general-intake listing is rejected.

`verify-preview.ts` performs one validation pass, then confirms each accepted source
identity and application link, with count-only artifacts. Any failed check is
uncertain; no accepted jobs means verification fails. Empty/old peer boards stay
explicitly unverified. Experimental sources still cannot publish or run live
verification. Missing jobs in observation feeds never prove closure.

The TEST matrix now runs this fetch/verify command for all four platforms, without
credentials or database access. New cloud results must be inspected after push;
[previous cloud run](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41508352332)
covered Pinpoint/Breezy/Manatal fetching before page-date and verification changes.

Backend draft PR #288 prepares all four sources with exact tenant-scoped attribution
and source/apply URL checks. The unapplied migration preserves observation-only
policy and existing verification cooldowns. In-memory PostgreSQL checks cover
idempotent replay, missing snapshots, scoped identity aliases, publication failures,
expiry and reader access. This is not hosted Supabase or deployment acceptance.

## Additional free API lead

[Get on Board's official help](https://www.getonbrd.com/help/what-can-i-do-with-get-on-board-s-api)
describes account-free public listings and building a job board from them. Its
[official SDK](https://github.com/getonbrd/getonbrd-ruby) confirms public search and
category routes. Three public search pages for "United States" yielded 29 unique
source IDs, only one with an explicit US country and recent date. US employer/client
mentions and generic remote jobs do not establish US eligibility. Implement and
measure resolved country restrictions before claiming an accepted-job yield.

## Remaining work

1. Inspect new TEST results, including application links and original-date rejection.
2. Complete isolated HTTP/Supabase acceptance, production-like failures and display
   checks. User explicitly prohibits local Docker; use in-memory PostgreSQL locally
   and a separate cloud test environment for full-stack acceptance. Existing TEST
   and production share Supabase and must receive no experimental writes.
3. Resolve Manatal freshness and expand useful real employer coverage. Confirm each
   provider's applicable reuse/attribution conditions and rate budget.
4. Implement Get on Board and continue alternatives beyond the original candidate list.
5. Prepare exact backend/collector commits, migration, board allowlists, schedules,
   identity seeding, rollback and post-rollout checks for approval. Production is
   not authorized by TEST success.
6. After approval, verify real Supabase writes and successful scheduled runs before
   incrementing the production platform count. Full goal remains 50 live platforms.

No provider contacted, account registered, or service purchased. Local Docker was
stopped following the user's instruction and is excluded from subsequent validation.
