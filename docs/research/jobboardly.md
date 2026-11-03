# Job Boardly — public-feed support, live customer access unresolved

Reviewed 2026-11-02. Job Boardly remains **one platform**, regardless of customer boards. No adapter added. This supplements `public-platform-candidates-yubhub.md`; previously failed Pennsylvania Communications and Trust & Safety feeds were not retried.

[Official feed documentation](https://help.jobboardly.com/en/articles/9664028-how-to-use-rss-feeds-and-xml-feeds), dated September 3, 2026, explicitly supports public `/jobs.xml` for external aggregators and importing jobs into other systems; `/jobs.rss` supports syndication. Feeds contain published listings, automatically update, and can be disabled by the board owner, returning 404. This is affirmative platform feed support, not proof that every customer endpoint is accessible or that every imported employer date is original.

## Bounded customer discovery

Two customers were selected through public search results, not guessed subdomains. Their own privacy policies identify Job Boardly as the hosting platform.

| Customer and primary evidence | Public US relevance | Single feed request |
|---|---|---|
| [ParlayJobs](https://www.parlayjobs.com/), [platform confirmation](https://www.parlayjobs.com/privacy-policy) | Public homepage showed Kambi Partner Support Manager in Philadelphia, Scientific Games Package Assembly Tech II in Gardiner, Maine, and DraftKings Analyst Intern in Boston. | `https://www.parlayjobs.com/jobs.xml` → HTTP **403** |
| [Side Hustle Monkey](https://jobs.sidehustlemonkey.com/), [platform confirmation](https://jobs.sidehustlemonkey.com/privacy-policy) | Homepage displayed 549 live jobs; examples included Capital One Customer Care Coordinator and Mass General Brigham Nurse Practitioner, both labeled United States. | `https://jobs.sidehustlemonkey.com/jobs.xml` → HTTP **403** |

Requests used ordinary HTTPS, 20-second timeouts, a five-MB response ceiling and no redirect following. Both stopped after 403. No alternate feed path, host, user-agent, browser or proxy workaround. No job payload was obtained, so full-description equality, employer-original dates, usable US count and accepted yield remain **unverified**. Homepage relative ages are not accepted publication provenance. ParlayJobs also displayed a Sweden-titled role as Stockholm, Maine, highlighting why location text needs validation before acceptance.

The [official Remote Marketing Jobs showcase](https://www.jobboardly.com/community-showcase/remote-marketing-jobs) identifies `remote.marketing` but describes a signup wall and planned paid access. Its gated content was not probed.

Status: research-only, supported feed capability but no accessible qualifying customer sample. Next step needs an enabled public customer feed reached through supported access, then bounded original-text/date comparison. No accounts, outreach, purchases, Docker, shared-database writes or production change.
