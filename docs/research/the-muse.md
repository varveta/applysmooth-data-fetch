# The Muse — registration and live-access blocker

Reviewed 2026-11-02. Existing tracker candidate, not another ready integration. No adapter added.

## Published access and display conditions

[Official v2 documentation](https://www.themuse.com/developers/api/v2) advertises public JSON jobs and companies. Keyless testing has a 500-request/hour limit; registered apps receive 3,600/hour. Registration is required beyond testing. The current documented base is `https://www.themuse.com/api/public`; the older `api-v2.themuse.com` redirects there. Job lists use required zero-based `page`, 20 results per full page, and location filters.

[API terms](https://www.themuse.com/developers/api/v2/terms), last modified 2015-07-25 on the live page, require app registration (§2.2), permit app content display under conditions (§3.1), require a Muse website backlink (§3.4), and prohibit content cloning or replicating Muse services (§3.3). Web scraping is prohibited (§4.3). Termination requires removing licensed copies (§13.3). These restrictions need review against ApplySmooth's persisted job catalog before ongoing use; this is not an unconditional full-dataset republication grant.

## Bounded live probe

One ordinary request at `2026-11-02T20:49:00Z`:

`https://www.themuse.com/api/public/jobs?page=0&location=New%20York%20City%2C%20NY&descending=true`

Result: HTTP **403**, CloudFront HTML, 919 bytes, `x-cache: Error from cloudfront`. The request stopped there. No legacy-host retry, browser workaround, challenge bypass or further API probe was attempted. Local evidence: `/tmp/themuse-list.headers` and `/tmp/themuse-list.json` (the latter contains the error HTML, not job JSON).

Consequently, full-description completeness, original employer publication dates and useful fresh US inventory remain **unverified**. Zero jobs fetched/accepted; no registration, outreach, database write, Docker use or publication. Next action requires owner-provisioned app access plus a successful authorized API sample and display-scope review. Do not include in account-free or production-ready counts.
