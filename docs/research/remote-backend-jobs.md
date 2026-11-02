# Remote Backend Jobs network — experimental

One platform across Backend/Frontend/Java boards. Public API and reuse terms:
[developer documentation](https://www.remotebackendjobs.com/developers),
[terms](https://www.remotebackendjobs.com/terms), checked November 2, 2026.
No key, account, payment or contact required. Show the named Remote Backend Jobs
credit linking to each provider job page; preserve the employer application URL.
Do not present imported jobs as ApplySmooth originals.

Adapter `remotebackendjobs:public` lists North America observations across the
network, a default window of 50 entries in one page. Every accepted candidate needs its
full detail body; snippets are never substituted. Fetches run serially with
600 ms spacing and bounded retry/backoff. Provider API redirects fail closed. The documented listing limit is 120
requests/minute. A capped or empty window never establishes closure.

A November 2 full-window validation failed after two successful list responses:
the pagination duplicate guard rejected an overlapping offset identity. Offset
pages can shift between requests; the default therefore uses a single capped
page. Explicit diagnostic windows may request up to 250 entries in pages of 50,
but still fail on repeated identities. This does not claim complete inventory.

Original provider `isoDate` remains unchanged; aggregator `createdAt` never
supplies freshness. North America alone does not establish US eligibility.
Payment/account/social-post metadata is removed during parsing. Archived dates
are explicit expiry evidence; unreviewed details fail collection.

## Read-only sample

{
  "observed_at": "2026-11-02T20:13:11.998Z",
  "fetched": 10,
  "accepted": 8,
  "gates": {
    "accepted": 8,
    "rejected": 1,
    "quarantined": 1
  },
  "us_eligible": 8,
  "fresh_15_days": 9,
  "reason_counts": {
    "us_eligibility_unknown": 1,
    "not_us": 1
  },
  "writes": 0
}

Sample capped at 10 listings; this is not the network's total inventory. Eight unit
checks pass, covering full content/date/link preservation, required per-job credit,
metadata stripping, geography, pagination, size caps, repeated identities and
failed/mismatched details. Cross-source uniqueness, cloud TEST, isolated backend,
and approved production activation remain separate gates. No database writes.

The default 50-listing window passed read-only validation at
`2026-11-02T20:28:45.561Z`: 43 accepted, 4 rejected as non-US, 3 quarantined for
unclear US eligibility; 42 accepted jobs had original posting dates within 15
days (49 of all 50 fetched). No missing posting dates. This used 41 live requests
and 10 schema-stripped cached details from the earlier sample, with zero database
writes. Discovery reports `maximum_jobs: 50`, `capped: true`, and observation-only
policy; this is not a full platform snapshot or proof of live ingestion.
