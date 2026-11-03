# Kula — technically verified public feed; redistribution scope unresolved

Reviewed November 2, 2026. Read-only public research; no adapter, registration,
provider contact, Docker, database write or production change.

## Public feed evidence

[Official feed documentation](https://support.kula.ai/articles/8061577825-publishing-an-xml-job-feed)
describes unauthenticated RSS 2.0 for job boards/aggregators, with complete
descriptions, publication dates, stable per-location reference numbers and explicit
locations. The same document instructs employers to obtain their URL from support
and hand it to job-board submission tools; it does not establish unrestricted
redistribution by unrelated aggregators discovering employer URLs themselves.

Ordinary unauthenticated GETs returned HTTP 200 and `application/rss+xml`:

| Public employer feed | Entries | Distinct role links | US entries | Within 15 days, US |
| --- | ---: | ---: | ---: | ---: |
| `https://careers.kula.ai/aetherbio/feed` | 6 | 6 | 6 | 4 |
| `https://careers.kula.ai/swiftly/feed` | 16 | 8 | 8 | 2 |
| `https://careers.kula.ai/fulcrum/feed` | 12 | 11 | 12 | 0 |

Counts are the November 2 probe, not production acceptance or incremental yield.
The location duplication is intentional: Swiftly's US/Canada variants share a
role/application URL but have different reference numbers. A future adapter must
preserve these IDs while allowing shared role identity for deduplication.
[Swiftly's employer careers page](https://www.goswift.ly/careers) directly links its
Kula careers page, confirming a real employer rather than a demo tenant.

## Full-content and date verification

Aether reference `64778-1922`, original role `64778`, has a 6,088-character feed HTML
description exactly equal to the employer JobPosting JSON-LD description at
`https://careers.kula.ai/aetherbio/64778-senior-program-manager-new-product-introduction`.
Both dates represent `2026-10-29T21:28:40.000Z`. The feed link and GUID are the
application URL `https://careers.kula.ai/aetherbio/64778/apply`. This establishes
full original text for the sampled role; no summary hydration is needed there.

Potential contract: source `kula`; tenant employer slug; `job:referencenumber` as
source ID; role segment as requisition identity unless an explicit requisition is
present; original `pubDate` only; `job:location.country` for US eligibility; visible
Kula/employer attribution linking original role. Unknown dates must stay unknown.
No runtime contract or shared enum has been added.

## Remaining permission boundary

[Kula's general service terms](https://www.kula.ai/legal) include restrictions on
scraping, redistribution and commercial exploitation of the platform/services.
Its public feed documentation expressly supports employer-authorized job-board
distribution, but the relationship between that intended use and unsolicited
aggregation remains unresolved. Technical access alone does not settle that
scope. Treat as research-only until the feed documentation is accepted as
sufficient authority for this use or an applicable employer/provider grant exists.
No legal conclusion that all integrations are prohibited is implied.

## Alternative with clearer feed republication language

[Dev Remotely](https://devremotely.com/feeds) expressly welcomes republication with
links back to original listings, offers free keyless JSON/RSS, a maximum 100-item
window, and location filters. However, the cached first feed item contains exactly
1,000 description characters, indicating truncation. Its public detail URL
`https://devremotely.com/jobs/senior-software-engineer-0L5yty` returned HTTP 403 in an
ordinary GET on this review. No workaround was attempted. It has clearer rights
language but remains blocked on complete original-description access; no adapter
is justified yet.
