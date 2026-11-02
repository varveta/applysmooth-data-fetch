# YubHub — experimental discovery with original Workday hydration

Reviewed November 2, 2026. Adapter and bounded loader implemented; no production
activation, database write, local Docker, account registration or provider contact.

[Official feed documentation](https://yubhub.co/free-job-feeds/) permits free job-board
redistribution with visible `Data by YubHub` attribution linking `https://yubhub.co`.
The US JSON feed returns at most 100 recently enriched records. Its advertised US
inventory is not the number available in one feed. Absence never proves closure.

## Original content is mandatory

Feed-only ingestion is unsuitable: matching GDIT requisition `RQ229564` has a
2,473-character feed description versus 10,653 characters in original Workday
JobPosting JSON-LD. Feed text omits citizenship/clearance qualifications and other
requirements. Feed date is October 29; original date is October 28. Feed salary
also differs from the current matching employer page.

Primary employer evidence:
[Workday posting](https://gdit.wd5.myworkdayjobs.com/en-US/External_Career_Site/job/USA-VA-Chantilly/Lead-DevSecOps-Engineer_RQ229564-2)
and [GDIT careers posting](https://www.gdit.com/careers/job/5656d9e4a/lead-devsecops-engineer/).
Ordinary unauthenticated GET returned HTTP 200 and original JobPosting JSON-LD.
No access restriction was bypassed.

The implementation uses YubHub only for discovery. Original employer title,
description, company, date, location and employment type replace enriched fields.
Feed titles can be rewritten; the original requisition must match the exact URL
suffix. Feed ID remains canonical source identity. Missing employer descriptions
or names become empty values rejected by existing quality gates, not invented
facts or an abort that discards otherwise valid peers. Original missing dates stay
null; enriched feed dates are never substituted.

## Request and identity boundaries

- Source `yubhub`, tenant `public` only.
- Feed URL: `https://feeds.yubhub.co/facet/country/united-states.json`.
- Source/application URLs must match each other and use HTTPS employer hosts shaped
  `{tenant}.wd{number}.myworkdayjobs.com`, with `/locale/site/job/location/slug` paths.
  Credentials, nondefault ports, query strings, fragments, encoded path separators,
  arbitrary domains and redirect escapes are refused.
- Exactly one original JobPosting per employer page; requisition must match the URL.
- At most 100 jobs; serial requests with 750 ms minimum spacing, two attempts,
  20-second request timeouts, bounded response sizes and a 40 MB aggregate cap.
- Discovery is always capped observation data. Duplicate IDs/URLs, unsupported
  domains, malformed identity, conflicting original identity or aggregate budget
  exhaustion fail the collection before publication. A missing original JobPosting
  or exhausted ordinary detail request retains the discovery ID with
  `original: null` and a fixed `hydration_error`; normalization throws a controlled
  error for per-posting quarantine. No summary fallback or closure inference.
- Credit: `Data by YubHub` linking `https://yubhub.co`.

## Evidence and remaining checks

Eighteen focused tests and TypeScript checks passed, including shared preparation
of mixed healthy/unverified jobs, invalid hydration state and aggregate budget
exhaustion. Tests cover original content
and dates, unknown eligibility, missing-field gates, same-job identity, unsafe URL
rejection, redirect restrictions, duplicate/count failures and failed details.

A bounded live probe hydrated one cached discovery entry from each of six employer
hosts: GDIT, TransPerfect, Target, CVS, HPE and 3M. All six original detail fetches
and identities succeeded. Four passed current quality gates; TransPerfect/HPE
were rejected for missing original employer names and dates older than 60 days.
Two of the four accepted samples have original dates within 15 days. This six-item
probe is not a full-feed count, unique incremental yield, cloud TEST, or production
readiness proof. Root-owned shared TEST/backend validation remains required.
Raw job content stays in temporary local files outside Git.

A full-feed validation exposed an additional original Workday shape: CVS
requisition `R1082958` supplies empty `title` and `datePosted` strings. The adapter
now sends the empty title through the `missing_title` rejection gate and preserves
the date as unknown. It still rejects malformed nonempty dates and invalid IDs.

The subsequent bounded rerun initially stopped after 30 requests at Target requisition
`R0000477772`: HTTP 200 returned a 6,173-byte application shell with an empty title,
no JobPosting JSON-LD, and no explicit closure evidence. Full original content and
identity could not be verified. The revised loader retains such entries for
`normalize_failed` quarantine while healthy original postings continue. Neither
that application shell nor an HTTP failure counts as closure evidence. Full-feed
Cloud TEST readiness still requires the hosted workflow and isolated database
acceptance checks.

The full revised loader subsequently completed all 100 discovery entries using 101
requests (including the feed), totaling 2,582,631 successful-response bytes. Cached
pre-deduplication quality gates produced 70 accepted, 28 rejected and two
`normalize_failed` quarantines. Rejection reasons overlap: 28 missing employer
names, 23 original dates older than 60 days, five missing titles. Fifty-one accepted
entries have original publication dates within 15 days; five identified rejected
entries have unknown original dates. This local read-only probe made zero database
writes and is not cloud TEST, unique incremental yield or production proof.

Final `validateTargets` replay using only those cached public responses succeeded:
100 fetched, 70 accepted after within-board deduplication, 28 rejected and two
quarantined; no accepted duplicates were collapsed. All 70 accepted rows preserve
the employer URL plus `Data by YubHub` → `https://yubhub.co` attribution. The replay
made zero new network requests and zero database writes. Counts and accepted rows
were handed to the root agent in temporary files outside Git for shared TEST work.
