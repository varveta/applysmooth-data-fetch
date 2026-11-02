# Goal: 50 distinct live production sources

Configured production baseline: 12. Additional live sources: 0. At least 38 new
platforms remain. Current database inspection finds active rows from 11 platforms;
Personio is configured and scheduled but currently contributes no accepted jobs.
Eleven experimental adapters are implemented; they do not count as production.
Candidate queue: 83 distinct platforms in `source-expansion-tracker.json`; research entries do not count as verified integrations.

## Latest cloud checkpoint: November 2

[Collector TEST run 41523776620](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41523776620)
fully passed source and accepted-link verification for eight platforms:

| Platform | Accepted | Verified open | Result |
| --- | ---: | ---: | --- |
| Pinpoint | 11 | 11 | Passed |
| Breezy | 45 | 45 | Passed |
| Manatal | 1 | 1 | Passed |
| Trakstar Hire | 3 | 3 | Passed |
| YubHub | 70 | 70 | Passed |
| Teamtailor | 2 | 2 | Passed |
| SpaceJobs.Now | 595 | 595 | Passed |
| Rails Job Board / JobKit | 7 | 7 | Passed |
| getwork.dev | 20 | 18 | Two uncertain links; incomplete |
| Get on Board | Not measured | 0 | First API request returned HTTP 403 |

The eight passing platforms contribute 734 accepted rows with verified open links.
Including Getwork, successful fetches produced 754 accepted rows: 752 open and two
uncertain. The saved aggregate artifact does not retain the two uncertain reasons;
no cause is inferred. Zero-accepted peer boards `breezy:subscribe` and
`manatal:trolley-2` remain unverified. All 595 accepted SpaceJobs original posting
dates remain unknown, so none counts as proven 15-day freshness.

Get on Board and Remote Backend Jobs are now deferred after hosted HTTP 403
responses. The current TEST manifest selects nine platforms. Collector local checks
pass: 474 tests and typecheck. Eleven adapters are implemented, with zero new
production sources and zero shared database writes.

Backend commit `00f018357b05af7f2ce48cbec58767904c93c828` passed
[full CI 41524185960](https://github.com/Sathvik-Chowdary-Veerapaneni/applysmooth/actions/runs/41524185960).
[Isolated acceptance 41524186125](https://github.com/Sathvik-Chowdary-Veerapaneni/applysmooth/actions/runs/41524186125)
failed when the harness tried to read 595 SpaceJobs rows in one request: URL length
and the search API's 100-ID limit require bounded chunks. The uncommitted harness
fix passes 13 mock tests, typecheck and changed-file lint; a successful cloud rerun
is not yet established. Only the historical first four platforms have full isolated
HTTP/Supabase acceptance evidence. Source/link TEST success does not establish
production ingestion or expanded isolated acceptance.

The earlier 797-row catalog comparison remains a separate sample: it includes both
now-deferred platforms and Pinpoint's earlier 10 rows. Its 790 rows without retained
catalog matches are an estimate, not proof of unique, fresh or live jobs.
[Count-only checkpoint evidence](evidence/2026-11-02-ten-source-cloud-checkpoint.json).

## November 2 first-batch checkpoint

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

Backend draft PR #288 now prepares eleven experimental source contracts. The first four completed actual
Next HTTP and disposable GitHub-runner Supabase acceptance in
[run 41515300570](https://github.com/Sathvik-Chowdary-Veerapaneni/applysmooth/actions/runs/41515300570):
59 real accepted rows, idempotent replay, authentication/RLS, scoped identities,
missing-observation protection, verification cooldown, closure and expiry.
No local Docker or shared Supabase writes were used. Publication conditions remain
unresolved; see [provider review](research/first-four-publication-review.md).

## Second batch: four additional adapters

| Platform | Fetched | Accepted | Rejected | Quarantined | Accepted within 15 days |
| --- | ---: | ---: | ---: | ---: | ---: |
| Remote Backend Jobs | 50 | 43 | 4 | 3 | 42 |
| Get on Board | 29 | 1 | 14 | 14 | 1 |
| YubHub | 100 | 70 | 28 | 2 | 51 |
| Teamtailor | 4 | 2 | 2 | 0 | 2 |

These time-specific local samples add 116 accepted rows, 96 with original dates
within 15 days. Combined with the first batch: 175 accepted rows across eight
platforms. Counts use empty identity snapshots; cross-source/current-catalog
unique yield for the second batch remains unmeasured. Collector tests: 411 passed;
backend contract/migration tests: 129 passed. All 175 real accepted rows passed
embedded PostgreSQL insertion and idempotent replay. These are historical local
checks; the latest cloud and isolated acceptance outcomes are recorded above.

Remote Backend Jobs is one platform across its network. Its default observation
window is explicitly capped at 50 because offset windows can overlap. Per-job
provider credit/link and original employer application link stay distinct.
Ten detail responses were reused from the earlier sample; the final pass made 41
new requests. Get on Board preserves all full description sections and explicit
country restrictions. Generic remote or US client mentions do not establish US
eligibility.

YubHub's 100-row US feed is discovery only. Original public employer JSON-LD supplies
company, title, full description and original dates; feed enrichment never replaces
these fields. Two originals could not be verified and remain quarantined. A missing
original does not discard healthy peers or prove closure. The final validation
replayed cached ordinary public GET responses; no additional network requests.
Teamtailor uses its documented RSS feed, preserving GUIDs, full descriptions,
original publication dates, exact tenant links and structured locations.

Count-only evidence: [second-batch report](evidence/2026-11-02-second-batch-local.json).
All four sources remain TEST-only and publication review is separate from technical
acceptance. No experimental source can publish through the live runner.

## Cloud result and third batch

[Eight-source TEST run 41520833751](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41520833751)
passed seven sources and 133 accepted application links. Pinpoint gained one new
posting after the local sample. Remote Backend Jobs returned HTTP 403 on its first
API request from GitHub. Its local result is retained, but automatic cloud attempts
are now deferred in `ingest/config/expansion-deferred.json`; no bypass is proposed.
The isolated backend run stopped on this fetch failure before starting Supabase.
It does not establish eight-source end-to-end success.

| Third-batch platform | Fetched | Accepted | Rejected | Quarantined | Accepted within 15 days |
| --- | ---: | ---: | ---: | ---: | ---: |
| getwork.dev | 20 | 20 | 0 | 0 | 20 |
| SpaceJobs.Now | 600 | 595 | 2 duplicates | 3 | 0 |
| Rails Job Board / JobKit | 12 | 7 | 1 | 4 | 1 |

All three passed local tests at this historical checkpoint. Total local samples:
797 accepted rows across eleven platforms, including both now-deferred platforms.
The collector suite then passed 441 tests and backend contract/migration tests passed
172. All 797 rows passed embedded PostgreSQL insertion and idempotent replay;
typecheck, changed-file lint and generated database type parity passed. The latest
cloud result and current nine-source manifest are recorded above.

SpaceJobs publishes full descriptions and explicitly supports external publication,
but its date field can be original posting time or first discovery without a flag.
All 595 accepted original publication dates therefore remain null and none is
counted fresh. The original text is preserved; one invalid derived zero-dollar
salary is omitted. Three conflicting country records are quarantined.
Getwork's original dates and full descriptions were checked against employer APIs;
its separate discovery time is never used as publication time. Public API access is
documented; external republication scope is unresolved. Rails uses the documented
JobKit RSS syndication feed, retaining full descriptions, original dates and exact
posting links. JobKit employer boards count as one platform.

The third-batch validation reuses cached ordinary GET responses and discloses cache
provenance. Evidence: [local counts](evidence/2026-11-02-third-batch-local.json),
[cloud outcomes](evidence/2026-11-02-eight-source-cloud-test.json).

A read-only comparison of all 797 rows with the retained catalog found seven
matching Getwork rows and no exact URL or normalized company/title match for the
other 790 rows. This estimates additional inventory, not historical uniqueness or
cross-platform deduplication. Provider wrapper URLs and changed labels can hide
matches. [Count-only overlap report](evidence/2026-11-02-eleven-source-overlap.json).

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
| Remote Backend Jobs network | Public API, full descriptions, explicit credit/link terms | Implemented as one source; bounded 50-result observation window |
| Active Vacancies | Public API and full descriptions work | Permission blocked: terms prohibit bulk competing commercial directories |
| YubHub | US feed contains 100 rows | Implemented with original employer hydration; 100-result observation window |
| Dev Remotely | Public feed contains 50 rows | Full-text gap: sampled feed content stops at 1,000 characters |
| Green Level | Public feed contains 1,462 rows | Descriptions absent; US yield unmeasured |
| Dev Global Jobs | Public developer documentation | Commercial reuse requires written permission |
| Career Nest | Live domain is parked | Unavailable; exclude until service is restored |

Remote Backend Jobs publishes [API limits and attribution requirements](https://www.remotebackendjobs.com/developers)
and repeats them in its [terms](https://www.remotebackendjobs.com/terms). Keep its job
page link and name credit intact. Its three network sites count once. The second-batch table above records the current local yield; production and
cross-source uniqueness remain unverified.

Active Vacancies' [developer page](https://activevacancies.com/developers) permits
apps/research/dashboards, but its [terms](https://activevacancies.com/terms) prohibit
bulk syndication into competing commercial directories. Treat this as permission
blocked despite the working API. No provider was contacted.

See tracker evidence URLs for each remaining candidate. Raw probe content stays in
temporary local files; no fetched job descriptions or incidental API fields are
checked into this repository.

## Four further research additions

| Platform | Evidence and blocker |
| --- | --- |
| Hacker News | Official keyless API; five sampled job stories lack descriptions. Monthly hiring comments provide original text but mixed role/location/application identity. Commercial republication permission remains unresolved. Both surfaces count as one platform. |
| Working Nomads | Public sample: 35 rows, 12 US-marked, descriptions 770–6,096 characters. Terms restrict commercial/competitive use; original employer text and dates remain unverified. |
| Authentic Jobs | Legacy API request returned 404; documentation returned 403. Current free access, key requirements and full-text inventory remain unverified. |
| SkipTheDrive | Homepage returned 403; terms require written permission for automated aggregation and restrict republication. No job payload obtained. |

Evidence: [Hacker News](research/hacker-news.md),
[Working Nomads](research/working-nomads.md), [Authentic Jobs](research/authentic-jobs.md),
[SkipTheDrive](research/skipthedrive.md). None is an implemented integration.
JobBoardly was already counted; four customer feed probes returned 403, so its
[additional evidence](research/jobboardly.md) does not increase the platform count.

## Remaining work

1. Preserve verified TEST source/link evidence and rerun after adapter changes.
2. Commit the bounded-read harness fix and rerun isolated HTTP/Supabase acceptance
   for the nine selected platforms, including failure and display checks. Resolve
   Getwork's two uncertain links. User explicitly prohibits local Docker; use
   in-memory PostgreSQL locally and a separate cloud test environment for full-stack
   acceptance. Existing TEST and production share Supabase and must receive no
   experimental writes.
3. Resolve Manatal freshness and expand useful real employer coverage. Confirm each
   provider's applicable reuse/attribution conditions and rate budget.
4. Continue alternatives beyond the original candidate list; agents research independent platforms in parallel.
5. Prepare exact backend/collector commits, migration, board allowlists, schedules,
   identity seeding, rollback and post-rollout checks for approval. Production is
   not authorized by TEST success.
6. After approval, verify real Supabase writes and successful scheduled runs before
   incrementing the production platform count. Full goal remains 50 live platforms.

No provider contacted, account registered, or service purchased. Local Docker was
stopped following the user's instruction and is excluded from subsequent validation.
