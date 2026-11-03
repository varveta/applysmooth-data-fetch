# Authentic Jobs — current API access unverified

Checked 2026-11-02; absent from source tracker before review. No adapter proposed.

Ordinary public reads produced:

| URL | Result |
| --- | --- |
| `https://authenticjobs.com/api/?method=aj.jobs.search&format=json` | HTTP 404 |
| `https://authenticjobs.com/api/` | HTTP 403 |
| `https://authenticjobs.com/api/docs/` | HTTP 403 |
| [Current homepage](https://authenticjobs.com/) | Public job-board shell; listing content requires JavaScript. No current API documentation exposed in inspected page links. |

No authenticated API request, registration, key request, purchase, contact or access-bypass attempt was made. Historical third-party packages/directories say an API key was required, but current official documentation could not confirm availability, free usage terms or the present key process. The blocker is therefore **current documented API/feed access unavailable**, not a proven claim that an obtainable free key would solve it.

No current listing sample, full-description preservation, original date provenance, stable source IDs, explicit US inventory or republication permission was established. Do not count historical API references as a ready free production integration. Reconsider only if a current official public feed or already-authorized API route is identified.

Research only; no Docker, database writes, production changes or commits.
