# JobScore — blocked pending employer feed and reuse permission

Reviewed November 2, 2026. No adapter, source registration, account, provider
contact, database write, Docker use or production activation.

## Documented capability

[Job Feed API documentation](https://support.jobscore.com/hc/en-us/articles/202001320-Developers-Guide-to-Job-Feed-APIs)
describes JSON/XML feeds for an employer's own careers website/application on paid
employer plans. Feed URLs come from the employer's Admin → Careers Site settings.
Published jobs include full HTML descriptions, stable IDs, explicit country,
`opened_date`, `last_updated_date`, and source/application URLs. Recommended polling
is daily; hourly is the documented maximum frequency. The separately authenticated
[Hire API](https://www.jobscore.com/integrations/jobscore-api/) is not this feed.

## Bounded probe and decision

Ordinary unauthenticated GETs to both supplied employer leads returned HTTP 404:

- `https://careers.jobscore.com/careers/simpplr`
- `https://careers.jobscore.com/jobs/simpplr/feed.json`

No live job payload, US count, full-description comparison or original dates were
established. No alternate domains or access-control workarounds were attempted.

[Website terms](https://www.jobscore.com/agreements/terms_of_service/), section 1,
limit website-material use to personal/noncommercial purposes and prohibit
redistribution/public commercial display. Section 2 distinguishes service-specific
agreements. The employer integration documentation does not establish a separate
grant for ApplySmooth to republish arbitrary employer feeds. This is a permission
gap, not a claim that an employer-approved integration is impossible.

Status remains research/provisioning. Resume only with a live employer-published
feed and applicable employer/provider redistribution permission. Preserve `id` and
`opened_date`; never replace the original date with `last_updated_date`. Do not add
an enum or count this platform as implemented, tested or production-ready.

## Strongest alternative

[Kula's official XML-feed documentation](https://support.kula.ai/articles/8061577825-publishing-an-xml-job-feed)
explicitly describes unauthenticated RSS 2.0 feeds for job boards and aggregators,
including full descriptions, publication dates, stable per-location reference
numbers, country and salary fields. Pattern: `careers.kula.ai/<account_name>/feed`.
The documentation directs employers to obtain their URL from support and hand it
to boards; a real employer feed and applicable use still need verification. This
is a research lead, not a validated replacement integration.
