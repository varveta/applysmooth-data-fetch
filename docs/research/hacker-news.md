# Hacker News — research only

Checked 2026-11-02; absent from the source tracker before this review. Job stories and monthly Who Is Hiring comments are one platform, not two source additions. No adapter proposed yet.

## Access and reuse

The [official Firebase API](https://github.com/HackerNews/API) documents unauthenticated reads of item IDs, types, original Unix creation times, HTML text, links and comment relationships. Its job-story endpoint returns a bounded latest-items window. Public API access works; no account or key was used.

[YC terms](https://www.ycombinator.com/legal/#terms) separately restrict commercial copying, distribution and publication unless expressly authorized. They grant YC rights over user submissions, which is not an explicit grant to arbitrary third-party commercial job boards. No feed-specific full-content commercial syndication permission was established in the reviewed official materials. The public API is technical access evidence, not proof that this additional use is authorized. This reuse scope remains unresolved; no outreach was made.

## Bounded live sample

- `https://hacker-news.firebaseio.com/v0/jobstories.json`: HTTP 200, 280 bytes, 31 IDs. Five latest items fetched: `50339827`, `50300643`, `50280824`, `50276779`, `50179455`. All five have zero description text. Titles and external links alone do not meet the full-description requirement. Two clearly mention US cities, but no accepted job count is claimed.
- Read only the submitted-ID list of official monthly publisher `whoishiring`, then four thread headers to distinguish hiring from job-seeker threads. No job-seeker comments or author profiles were collected.
- [November hiring thread 50338728](https://news.ycombinator.com/item?id=50338728): original thread time `2026-11-02T16:01:37Z`, 108 top-level comment IDs at observation time. This is neither 108 verified vacancies nor a complete current inventory.
- Five top-level hiring comments sampled, with unchanged API HTML text and original comment timestamps. Plain-text lengths ranged 357–817 characters. Replies were not fetched.

| Comment | Observed structure | Limitation |
| --- | --- | --- |
| `50343555` | Virtusan; Switzerland/EU remote; 637 plain characters | Explicit non-US geography; no separate role field in header. |
| `50343534` | Eleshop; Senior PHP Full-stack engineer; Europe/Africa/West Asia remote; 357 characters | Explicit non-US reach. |
| `50343258` | Relevant Healthcare; Lead Engineer; remote US/Canada only; 790 characters; original time `2026-11-02T20:30:08Z` | Full original hiring comment exists, but its only HTTPS link is generic `https://relevant.healthcare/jobs/`, not a verified role-specific application. |
| `50342723` | Fly.io; remote multiple countries; 444 characters | Three distinct role URLs in one comment; location does not establish US eligibility. |
| `50342996` | Datadog; Software Engineers; multiple cities; 817 characters | Multiple roles, marketing/article links and generic hiring redirect; no single verified application identity. |

## Requirements before an implementation proposal

Use the original numeric comment ID as identity and exact `https://news.ycombinator.com/item?id={id}` as source. Require a live top-level `comment` whose `parent` is the verified hiring thread; reject deleted/dead items and job-seeker/reply threads. Preserve author-written HTML as full plain text; do not turn headlines or excerpts into fabricated JDs. Comment creation is the source ad's date, not independently proven employer ATS publication time.

Company, one role, explicit hiring geography and a role-specific HTTPS application must be present; never infer US eligibility from remote status, headquarters or time zones. Multi-role comments need a separate identity policy before splitting. Missing comments in a bounded sample are never closure evidence. No current sample demonstrates all required gates plus established reuse permission, so implementation remains held.

Caches: `/tmp/research-hn-jobstories.json`, `/tmp/research-hn-item-50338728.json`, `/tmp/research-hn-comment-{id}.json`. No production changes, Docker, database writes, registrations, contact or commits.
