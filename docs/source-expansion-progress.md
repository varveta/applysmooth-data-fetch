# Goal: 50 distinct live production sources

Configured production baseline: 12. Additional live sources: 0. At least 38 new
platforms remain. Current database inspection finds active rows from 11 platforms;
Personio is configured and scheduled but currently contributes no accepted jobs.
Four experimental adapters are implemented; they do not count as production.
Candidate queue: `source-expansion-tracker.json` (46 candidates; none counted merely for appearing in this queue).

## November 2 checkpoint

| Platform | Fetched | Accepted | Rejected | Quarantined | Known recent | Unknown dates | Verified links |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pinpoint | 14 | 10 | 4 | 0 | 10 | 0 | 10 |
| Breezy | 71 | 45 | 26 | 0 | 45 | 0 | 45 |
| Manatal | 2 | 1 | 0 | 1 | 0 | 2 | 1 |
| Trakstar Hire | 4 | 3 | 1 | 0 | 3 | 0 | 3 |

Counts are time-specific local samples, using empty identity history. Cross-source
unique yield remains unmeasured. Zero shared database writes. Known-recent counts
in this historical table use the 60-day ingestion gate, not the 15-day visibility
window. New reports separately count original postings within 15 days, before and
after acceptance/deduplication; unknown and future dates never count as fresh.
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

The TEST matrix passed for all four platforms without credentials or database
access: [verified run 41511555771](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41511555771)
confirmed all 59 accepted application links and the original-date rejection counts.
No shared database writes occurred.

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

## Freshness and current-catalog overlap

Read-only comparison on November 2 found zero matching application URLs and zero
matching normalized company/title pairs for the 59 accepted sample rows against
all 7,620 retained catalog rows. This estimates incremental inventory; it does not
prove uniqueness against deleted history or differently named duplicate postings.
No deduplication policy or database content was changed.

Of those 59 accepted rows, **24 have original posting dates within 15 days**:
Pinpoint 2, Breezy 19, Manatal 0, Trakstar 3. The earlier 60-day gate count must not
be described as 15-day freshness. One accepted Manatal job has an unknown date.

Current catalog has 7,085 published, nonexpired rows from 11 platforms. The twelfth
configured source, Personio, completed its [latest scheduled run](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41498457799)
with six fetched and zero accepted. A write-free recheck confirms five old-date
rejections and three non-US rejections (reasons overlap). This needs fresh eligible
employer coverage before claiming 12 platforms currently contribute jobs.

The latest [Greenhouse schedule](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41490393421)
partially failed: Roblox and Anduril publication exhausted retries with HTTP 502;
other boards completed. Record this baseline health issue for diagnosis before
production rollout; this task has not rerun or changed production ingestion.
Count-only evidence: `evidence/2026-11-02-catalog-overlap.json`.

## Seven further candidates reviewed

| Platform | Read-only evidence | Next decision |
| --- | --- | --- |
| Remote Backend Jobs network | Public API, full descriptions, explicit credit/link terms | Implement as one source across backend/frontend/Java; 250-result API cap |
| Active Vacancies | Public API and full descriptions work | Permission blocked: terms prohibit bulk competing commercial directories |
| YubHub | US feed contains 100 rows | Verify original full descriptions; feed is an enrichment-sorted window, not a complete snapshot |
| Dev Remotely | Public feed contains 50 rows | Full-text gap: sampled feed content stops at 1,000 characters |
| Green Level | Public feed contains 1,462 rows | Descriptions absent; US yield unmeasured |
| Dev Global Jobs | Public developer documentation | Commercial reuse requires written permission |
| Career Nest | Live domain is parked | Unavailable; exclude until service is restored |

Remote Backend Jobs publishes [API limits and attribution requirements](https://www.remotebackendjobs.com/developers)
and repeats them in its [terms](https://www.remotebackendjobs.com/terms). Keep its job
page link and name credit intact. Its three network sites count once. A five-row
probe and one full-description response establish API access only, not accepted
unique US-job yield.

Active Vacancies' [developer page](https://activevacancies.com/developers) permits
apps/research/dashboards, but its [terms](https://activevacancies.com/terms) prohibit
bulk syndication into competing commercial directories. Treat this as permission
blocked despite the working API. No provider was contacted.

See tracker evidence URLs for each remaining candidate. Raw probe content stays in
temporary local files; no fetched job descriptions or incidental API fields are
checked into this repository.

## Remaining work

1. Preserve verified TEST source/link evidence and rerun after adapter changes.
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
