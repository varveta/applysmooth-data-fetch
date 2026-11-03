# OnJob.io — promising feed; verification incomplete

Reviewed November 2, 2026. Distinct platform, absent the 83-candidate tracker at
research start. No adapter, account, provider contact, or database writes.

## Public access and reuse

The [official jobboard feed invitation](https://onjob.io/for-job-boards/)
authorizes free crawling, caching and republication, including commercial boards,
with each listing linked to its OnJob application page. It documents daily refresh,
JSON/XML pagination, and pages below 25 MiB. The feed itself repeats that license.
[General terms](https://onjob.io/terms/) restrict unauthorized automation and
candidate harvesting; the specific feed invitation covers public job data only.

Public endpoint: `https://onjob.io/feeds/jobs.json`.

## Bounded live evidence

One unauthenticated GET returned HTTP 200, 5,827,874 bytes, page 1 of 1, 824 jobs.
Feed generated time: `2026-11-02T21:13:58.378Z`. This was a single observed snapshot,
not an ongoing completeness or closure guarantee. Exactly 47 rows declare
`countryCode: US`, across 14 employer labels; 295 rows lack a country code.
US description text spans 546–5,173 characters after tag removal, HTML decoding and
whitespace normalization. These are candidate counts, not gate-accepted jobs.

Rows expose UUID `id`, title, company, location, country code, `descriptionHtml`,
`datePosted`, provider source/apply URLs and matching JobPosting JSON-LD.
Provider date range for those 47 rows: August 11–November 2, 2026. Original employer
publication dates are not established; an eventual adapter must keep them null.

Three exact US-feed source/application URLs were read once:

- EdgeQ DevOps Engineer, `01a19cef-4d34-787d-955d-b3b7acf179c1`: HTTP 200, 140,747 bytes.
  URL `https://onjob.io/job/devops-engineer-edgeq-technologies-private-limited-dallas-01a19cef-4d34-787d-955d-b3b7acf179c1`.
  Page JSON-LD description exactly matches feed HTML, with matching ID and date.
  The public page marks `jobSource: ats` and `external: true`; its `datePosted`
  equals the record's `created_at`. No original employer posting link was exposed
  in the inspected public data. Matching the provider page therefore establishes
  provider-text fidelity, not full original employer provenance.
- Recruitment Room Chief of Staff: `b5c77763-ef5d-458b-a553-fb75ae760bcf`, HTTP 403.
- Recruitment Room Senior Photographer: `35bcdcbb-ab0a-4588-b0b0-52d62d5f894e`, HTTP 403.

The latter URLs respectively end in
`/job/chief-of-staff-remote-recruitment-room-remote-b5c77763-ef5d-458b-a553-fb75ae760bcf`
and `/job/senior-photographer-remote-recruitment-room-remote-35bcdcbb-ab0a-4588-b0b0-52d62d5f894e`.
No blocked page was retried or bypassed. These are local ordinary-GET results,
not GitHub workflow results. The accessible page asks candidates to sign in to
apply; no registration or application was attempted.

## Decision

Hold implementation: two application reads blocked, full employer-original text
unverified, original-date semantics unresolved. A future adapter would need exact
raw HTTPS `onjob.io/job/{slug}-{uuid}` identity binding, provider backlink credit,
explicit country-conflict handling, bounded pages/bytes and observation-only
absence policy. Do not mistake feed `generated`, row creation, or default expiry
for employer publication or closure evidence. Raw responses remain temporary.
