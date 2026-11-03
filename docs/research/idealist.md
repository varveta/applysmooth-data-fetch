# Idealist — documented partner listings API requires issued key

Reviewed November 2, 2026. Distinct nonprofit-sector platform absent the
83-candidate tracker at research start. No adapter or API-data probe.

The [official Listings API documentation](https://api-sandbox.idealist.org/listings-api)
provides a genuine read API, separate from its paid job-posting API:

- `https://www.idealist.org/api/v1/listings/jobs`
- `https://www.idealist.org/api/v1/listings/jobs/{job_id}`

Documented detail fields include description, original `firstPublished`, update,
expiry, company, explicit job address/country, remote restrictions, and application
URL/text. Listing pagination uses inclusive `since`, maximum 100 rows. Partner
attribution uses approved Idealist branding; clients should request sequentially,
wait at least 250 ms, and preserve their cursor. These are documented shapes,
not measured live US yield or proof of original-text completeness.

Blocker: production API keys are manually issued on request and use Basic auth.
No key, registration, contact, or sample credential was used. Free commercial
access was not established. Stop here under the no-contact/no-registration scope;
public documentation is not an anonymous production feed. Do not implement or
count as production-ready until authorized access and actual sample validation exist.
