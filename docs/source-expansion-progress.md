# Goal: 50 distinct live production sources

Configured production baseline: 12. Additional live sources: 0. At least 38 new
platforms remain. Current database inspection finds active rows from 11 platforms;
Personio is configured and scheduled but currently contributes no accepted jobs.
Twelve experimental collector adapters are implemented; eleven backend contracts are prepared. Neither count establishes production activation.
Candidate queue: 93 distinct platforms in `source-expansion-tracker.json`; research entries do not count as verified integrations.

## Latest cloud checkpoint: November 2

[Collector TEST 41527719781](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41527719781)
passed source and application-link checks for eight platforms: Pinpoint 11,
Breezy 45, Manatal 1, Trakstar 3, YubHub 70, Teamtailor 2, SpaceJobs.Now 595,
and Rails Job Board 7 accepted jobs (734 total). Getwork accepted 20 and confirmed
18 application links; one employer URL returned HTTP 403 and one redirected to a
generic careers/login page. The source remains unverified for publication; no
blocked request was bypassed or treated as open.

[Isolated HTTP/Supabase acceptance 41527905492](https://github.com/Sathvik-Chowdary-Veerapaneni/applysmooth/actions/runs/41527905492)
**passed all nine selected platforms and 754 real rows**. Every row was inserted,
read back, and replayed; original content, dates, identity, missing-snapshot safety,
search, permissions, guest delay, cooldown, closure and expiry checks passed.
The test used disposable GitHub services and wrote nothing to shared Supabase.
Collector SHA: `92e3d074027082af1db1c18fa78b9c3bac754949`. Backend head:
`18b5b3d33f7e2f64736281259729713244d1eee1`; tested PR merge SHA:
`1b4351ed3b4add9d86a860432aafc3c4196c03ec`.
[Full backend CI 41527905448](https://github.com/Sathvik-Chowdary-Veerapaneni/applysmooth/actions/runs/41527905448)
also passed. These results supersede the earlier large-read harness failure;
Getwork's separate link failures still prevent a complete publication claim.

Get on Board and Remote Backend Jobs remain deferred after hosted API HTTP 403s.
Zero-accepted peer boards SUBSCRIBE and Trolley remain unexercised for insertion.
SpaceJobs' 595 original dates remain null and are not claimed fresh.
[Count-only checkpoint evidence](evidence/2026-11-02-nine-source-cloud-checkpoint.json).

RemoteFirstJobs is the twelfth locally implemented collector adapter: 100 fetched,
43 accepted, 31 non-US rejected, 26 unknown-US quarantined; all original dates are
unknown. It has not passed hosted TEST or backend acceptance. The master working
manifest selects ten sources including it; the next incremental cloud batch
selects only Getwork and RemoteFirstJobs to avoid redundant provider reads; the passing cloud run above selects
only nine. Collector checks now pass 501 tests and typecheck. Backend contracts for
this new source use a separate additive migration. All 43 cached rows passed
HTTP and embedded PostgreSQL insertion/readback/replay; 285 contract/migration
tests, typecheck, lint and 88-migration generated-type parity passed.

The initial rollout proposal remains SpaceJobs.Now and Rails only. Their technical
checks and documented feed-syndication basis are recorded, but activation is not
approved. A manual read-only writer diagnostic is ready in
[PR #18](https://github.com/varveta/applysmooth-data-fetch/pull/18) (343 tests and CI passed), approved for diagnostic only:
GitHub's existing `test` environment permits secrets only on `main`. No protection
will be weakened. The current 49 persisted source/tenant scopes are all identity-ready;
a scoped empty identity read can confirm the writer's matching allowlist without
extracting sensitive values or writing job data.

The older 797-row catalog comparison is a separate sample including both deferred
sources and Pinpoint's earlier 10 rows. Its 790 rows without retained matches remain
an estimate, not proof of unique, fresh or live jobs. RemoteFirstJobs overlap has
not been measured. Additional live production sources: **zero**.

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

## Getwork prepublication correction

The current collector checks quality-eligible Getwork copies before duplicate
representative selection. Non-open checks quarantine; verified aliases retain
historical identity and dates. Unverified copies contribute no accepted content.
The same online preparation runs in publication and TEST, with an exact-run cache
that prevents preview from retrying failed links. Counts distinguish quality
acceptance, link quarantine, and deduplication. Pure offline preparation remains
network-free. The next hosted batch will measure the actual admitted count; the
expected 18 from the earlier 20-row sample is not claimed as a new live result.

A disposable application of the initial SpaceJobs/Rails activation patch passed
533 tests and typecheck against this working state. The actual collector remains
TEST-only for every added source.

PR #18 merged after owner approval. Diagnostic run41532514498 stopped before
requests because the configured endpoint did not exactly match the expected TEST
alias; configuration matched49 audited boards and credentials were present.
Writer binding remains unresolved; no source activation was authorized.
