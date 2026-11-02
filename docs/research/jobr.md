# Jobr — working public XML; application verification blocked

Reviewed November 2, 2026. Distinct platform absent the 83-candidate tracker at
research start. No adapter, account, provider contact, or database writes.

[Official feed documentation](https://jobr.pro/job-feed) permits jobboards,
aggregators and career sites to syndicate its listings. It documents full HTML
content, stable IDs, a US country filter, default 100 / maximum 500 rows, hourly
cache refresh and provider application redirects. Retain each `jobUrl` backlink;
visible Jobr credit is also requested. [General terms](https://jobr.pro/terms)
restrict unauthorized use and automation outside intended use; the feed-specific
invitation explicitly describes programmatic syndication. Review that distinction
before eventual publication; it is not permission to access private product APIs.

Endpoint tested once: `https://jobr.pro/feed.xml?location=US&limit=5`.
HTTP 200, 32,821 bytes, five jobs, generated `2026-11-02T21:25:59.764Z`.
No pagination was documented, so any limit is an observation window; absence
cannot establish closure.

| Source ID | Employer | Plain description characters | Explicit location |
| --- | --- | ---: | --- |
| 118446564 | CIEE | 6,359 | Massachusetts, MA, US |
| 118446384 | Points of Light | 6,909 | Remote, Remote, US |
| 118452931 | Columbia Hospitality | 5,605 | Seattle, Washington, United States of America |
| 118452405 | Riverbend Health & Wellness | 2,594 | Scranton, PA, US |
| 118452304 | Riverbend Health & Wellness | 2,594 | Scranton, PA, US |

Counts use HTML decoding/tag removal/whitespace normalization. Five explicit-US
candidates are not five accepted unique jobs; two Riverbend listings have the
same title and text length. Preserve both provider IDs until normal deduplication.

Source URLs follow `https://jobr.pro/job/{numeric-id}/{slug}`; apply URLs follow
`https://jobr.pro/r/{same-id}`. For CIEE and Columbia, source pages returned 200
(187,648 / 207,546 bytes), with matching provider URL/date/full description in
JobPosting JSON-LD. CIEE HTML differs by three bytes while preserving its content;
Columbia HTML is identical. JSON-LD identifier values are employer IDs `575633`
and `76517`, distinct from provider IDs. An eventual source must retain provider
IDs as catalog identity and not replace them with employer IDs.

Both exact application redirects returned HTTP 403 during ordinary unauthenticated
GETs. No retry or bypass occurred. The original-employer full-text comparison is
therefore incomplete. `datePosted` is a provider publication field, not verified
original employer time; keep normalized `postedAt` null unless that provenance is
established. Do not treat the page's generated-looking expiry as employer closure.

Decision: hold implementation/readiness. This feed is technically promising, but
working source pages do not prove working applications or full original text.
No hosted TEST or production success is claimed. Raw responses remain temporary.
