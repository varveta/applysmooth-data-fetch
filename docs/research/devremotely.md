# Dev Remotely — full-description blocker

Status: investigated; no adapter or source ID should be activated. No database
writes, Docker use, account registration, provider outreach, purchase or schedule.

## Access and reuse evidence

The [official feed documentation](https://devremotely.com/feeds) offers free,
keyless JSON Feed/RSS endpoints, optional location filters, a default 50-item
window, a maximum 100 items and approximately 15-minute caching. It permits
republication while keeping the original provider listing link.

The [terms, section 7](https://devremotely.com/terms) restrict bulk copying or
republication to the published feeds and embeds. General full-detail page
scraping is therefore not an established production ingestion path. No provider
was contacted to request broader permission.

## Bounded read-only probe — November 2, 2026

Existing JSON feed sample: 50 items. Its first job,
`https://devremotely.com/jobs/senior-software-engineer-0L5yty`, contained exactly
1,000 description characters. Reading that single normal public job page showed
3,451 characters in JobPosting JSON-LD, confirming that the feed omits substantial
job content. The JSON-LD called its location Worldwide; that is not explicit US
eligibility under the current collector gates.

RSS for the same job (`/feed/jobs.xml?limit=1`) had a 531-character description,
including display metadata, with no `content:encoded` or alternative full-text
field. Switching from JSON to RSS does not solve completeness.

A separate US-filtered feed probe (`/feed/jobs.json?location=United%20States&limit=3`)
returned three items. The first two had explicit US locations, but both the feed
and corresponding page JobPosting description were exactly 500 characters. Their
original full employer descriptions were not established. Their RSS descriptions
were 552 and 545 characters including display metadata. Those records must not be
represented as verified complete job descriptions.

Probe requests used normal public URLs, a declared ApplySmooth user agent,
20-second timeouts, bounded bodies and rejected redirects. Raw job text remains
in temporary local files, not this repository. No application was submitted.

## Decision

- Do not implement a feed adapter that treats snippets as full descriptions.
- Do not bulk fetch detail pages under the existing feed-only reuse exception.
- No accepted-job or unique-US inventory yield is established.
- Reconsider if a documented, permitted full-description feed/API appears, or
  provider permission is obtained through separately authorized outreach.
- The platform is one research candidate, not an implemented or production source.
