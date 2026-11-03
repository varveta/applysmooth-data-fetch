# Oru — public full Atom feed; measured tenant is stale

Reviewed November 2, 2026. One platform across all customer boards; absent the
83-candidate tracker at research start. No adapter or shared tracker edit.

[Official integrations](https://oru.club/integrations) explicitly describe RSS for
external newsletters/aggregators and full job details. The separate REST API needs
a Bearer token and is not a public alternative. [Terms](https://oru.club/terms)
retain contributor ownership and grant Oru distribution rights; no broad third-party
commercial content license beyond the published syndication feature was verified.

The [official directory](https://oru.club/discover) identifies a real customer,
[PGE Remote Hub](https://pge-remotehub.oru.club/), separately from its demo board.
Its public footer links `https://pge-remotehub.oru.club/feed.atom`.
One ordinary GET returned HTTP 200, 182,702 bytes and 20 entries. Atom IDs are exact
provider job URLs; records contain full HTML content and publication timestamps.
Plain content spans 2,137–11,019 characters after HTML/tag/whitespace normalization.

All 20 publication dates are April 2026: seven April 12, five April 17, eight
April 20. None is recent enough for the collector's 60-day gate on November 2.
Two descriptions mention USA/United States; those incidental mentions were not
counted as US eligibility. The board labels one Deel role USA/EMEA, but original
employer eligibility and current availability were not independently established.
No descriptions were compared with original employers because this tenant's entire
feed is already stale. Provider Atom publication time may differ from original
employer time and requires separate verification.

Decision: do not implement this tenant. Keep Oru as a concrete public-feed candidate
only if a fresh, useful US customer board is found. Multiple Oru boards count once.
No demo data, private API requests, registration, provider contact, or writes used.
Absence from a feed is not closure evidence; an adapter would need bounded feeds,
exact tenant/job identity links, content provenance and explicit US restrictions.
