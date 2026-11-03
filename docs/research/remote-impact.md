# Remote Impact — free access lacks commercial full descriptions

Reviewed November 2, 2026. Distinct impact-sector platform absent the 83-candidate
tracker at research start. Documentation-only rejection; no adapter/data probe.

[Official developer documentation](https://remoteimpact.org/developers/) exposes
`https://remoteimpact.org/api/v1/jobs/` without a key for evaluation, with country,
source and pagination filters. Anonymous limits are 10 requests/minute, 100 data
requests/day, 10 roles/page and three pages/query. Public examples contain IDs,
source links, eligible countries, dates and verification status; no live US count
or original-date validity was measured in this review.

The documentation states that aggregated roles expose excerpts rather than full
employer descriptions. Full text is limited to employer-posted roles under the
commercial tier. Free access is for evaluation/noncommercial work; commercial
product access requires a paid license. Separate free RSS/JSON offerings are
addressed to communities/newsletters, not unrestricted full-description jobboard
republication. Attribution and freshness requirements also apply.

Decision: not a free ApplySmooth integration. Do not build around excerpts or treat
an accessible API as commercial full-content permission. No provider contact,
registration, purchase, blocked-request retry, or database write occurred.
