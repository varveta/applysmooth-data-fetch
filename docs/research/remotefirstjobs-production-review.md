# Remote First Jobs production review — 2026-11-03

Scope: display on ApplySmooth with per-job Remote First Jobs credit and provider application URL. No onward submission to Google Jobs, LinkedIn Jobs, Jooble, or other third-party job sites. The public API and RSS documentation expressly invite website/application and own-job-board integration:
- https://remotefirstjobs.com/jobs-api
- https://remotefirstjobs.com/rss

Read-only local sample: 100 fetched, 43 US-eligible accepted, 31 non-US rejected, 26 ambiguous-location quarantined. All 43 accepted provider links confirmed open. Original employer posting dates remain unknown/null; aggregator publication must never be represented as original posting time. Feed absence never closes a posting. Daily collection is bounded to the configured observation window.

Activation requires hosted link verification, isolated HTTP/database acceptance, production source contract and board allowlist, runtime activation, and live ingestion evidence. Code approval alone does not enable publication.

Other current checks: Remote Backend Jobs fetched 50, accepted 36 by content gates, but only 22 links verified (13 HTTP 403, one generic careers/login redirect); remains inactive. Get on Board produced one eligible job locally; hosted access unproven. Getwork produced 17 accepted jobs with verified links, but full-text republication scope remains unresolved. Pinpoint, Breezy, Manatal, Trakstar, Teamtailor and YubHub retain the publication/access restrictions documented in existing source reviews. SpaceJobs remains disabled after hosted timeouts.
