# Second four sources: scoped publication proposal

Reviewed November 2, 2026: Remote Backend Jobs, Get on Board, YubHub, Teamtailor.
This reviews published access/reuse conditions, separately from TEST success and
production activation. Existing source research files supplied implementation
context; primary documents were rechecked below. No account, contact, payment,
application, or production write occurred. No code or manifest was changed.

| Source | Positive publication evidence | Proposed scope and remaining gate |
| --- | --- | --- |
| Remote Backend Jobs | Explicit free API/feed reuse with named credit and provider job links. | Include API-only collection in the production proposal once visible per-job credit/link is verified. |
| Get on Board | Official public API guidance explicitly permits external listings and custom job boards. | Include public job API collection, retaining provider application links and excluding candidate/private operations. |
| YubHub | Explicit free-feed redistribution for job boards and aggregators with credit. | Feed permission is established; the current additional Workday hydration route still needs source-specific access/content review. |
| Teamtailor | Official public RSS guide explicitly supports sending job descriptions/data to promotion channels. | Suitable for scoped employer-feed syndication; record employer scope/authority before claiming unrestricted cross-employer aggregation. |

These are different evidence levels. An unresolved downstream condition is not a
blanket finding that a platform prohibits public feeds.

## Remote Backend Jobs: explicit API reuse, preserve both links

The [developer page](https://www.remotebackendjobs.com/developers) documents
unauthenticated JSON listing and `/api/jobs/:id` full-detail endpoints, no signup or
key, and use by external applications. The [terms, API/feeds/MCP section](https://www.remotebackendjobs.com/terms)
explicitly permit free use subject to named credit, a link to each provider job,
preserving provider links, staying within limits, and not presenting resubmitted
listings as one's own. The October 2026 terms prohibit service-degrading crawling
and rate-limit bypass.

**Concrete display contract:** show `Remote Backend Jobs` linked to
`https://www.remotebackendjobs.com/{observed_source_job_id}` on the displayed job.
Keep the original employer `link` as the application destination. The employer
application button alone does not satisfy the required provider link. These are
two separate destinations. No employer HTML hydration is needed: full content is
obtained from the documented provider detail API.

**Access scope:** the API caps `offset + limit` at 250; documented listing/count
limits are 120 requests/minute/IP. Current default collection uses one 50-job
observation page plus serial details, reports its cap, and rejects overlapping
identities if larger diagnostic pagination is requested. Backend, Frontend, and
Java boards remain one network source. This scoped public grant supports the
proposal; it does not authorize unrelated employer-page scraping.

## Get on Board: explicit public job-board use

The [official public API guidance](https://www.getonbrd.com/help/what-can-i-do-with-get-on-board-s-api)
expressly permits displaying published jobs on another site and building a custom
job board. Public resources need no setup; private company/candidate operations
are a separate authenticated product. This is affirmative publication guidance,
not merely evidence of a reachable endpoint.

The current [customer terms](https://www.getonbrd.com/about/tos), September 17,
2026, §§7–9, restrict copying/platform-IP use, reserve rights, and retain customer
ownership of customer content; §7 also makes API use subject to documentation and
throttling. Read those customer-account provisions alongside the express public
API use cases. The scoped inference here is that public-listing display through
the documented API is supported, not that GoB software, candidate data, or every
platform resource is freely redistributable.

**Concrete proposal:** use public job endpoints only; show `Get on Board` linked
to `https://www.getonbrd.com/jobs/{observed_source_job_id}` and send applications to
that same provider page. The exact credit is our provenance implementation; no
mandatory credit phrase was located in the reviewed API guidance. The provider's
[agent/application guidance](https://www.getonbrd.com/help/can-ai-agents-apply-to-jobs-or-scrape-profiles-on-get-on-board)
requires applications through Get on Board and rejects automated applications and
candidate-profile scraping. This collector does neither. Do not expand public
job permission into application submission or off-platform CV collection.

## YubHub: feed permission does not transfer source-site authority

The [free-feed page](https://yubhub.co/free-job-feeds/) explicitly invites job boards
and aggregators to redistribute its free RSS/JSON/XML feeds. It requires retaining
the `Data by YubHub` attribution link to `https://yubhub.co`; no account or API key
is required. Preserve that per-item credit when importing, including when replacing
the enriched description with an original description. A hidden database field is
insufficient to preserve a credit link for readers: display it with each job.

The [terms](https://yubhub.co/terms/), dated March 9, 2026, §4 prohibit use that
violates third-party terms and restrict redistribution of the **service** without
consent. The specific free-feed page affirmatively allows feed redistribution;
this review does not reinterpret that service restriction as a ban on the
advertised free feeds. Section 6 says YubHub does not own the underlying job
content and leaves compliance with source-site terms to the feed user. Therefore
YubHub's credit condition does not itself settle the employer-content question.

**Current implementation distinction:** the feed supplies discovery IDs, but the
loader separately GETs original `*.myworkdayjobs.com` pages and copies their
JobPosting title, description, employer, geography, and dates. Local research found
material omissions in feed summaries, so removing hydration and treating those
summaries as complete descriptions is not a valid production shortcut. Successful
HTTP 200 and JSON-LD identity checks prove availability/correctness, not an
independent right to automate those original-page reads or republish their text.

**Scope trap:** the indexed [Workday End User Agreement](https://www.workday.com/en-us/legal/end-user-agreement.html)
contains automation/scraping restrictions, but its definition of “Website” is
`scoutrfp.com` and its subdomains. It is not evidence of a blanket
`myworkdayjobs.com` restriction. This review has not established a common applicable
license or prohibition for all employer Workday tenants. The previous successful
GDIT, Target, CVS, HPE, 3M, and TransPerfect probes do not fill that gap.

**Concrete gate for current hydrated pipeline:** inventory the employer hosts that
would be activated; attach applicable career-site access/reuse terms or existing
employer authorization for each permitted scope. Where terms explicitly restrict
the required reads/republication, use a permitted employer feed/API or obtain the
needed permission before including that scope. Where applicability is unclear,
record the specific unresolved condition instead of labeling all Workday access
prohibited. A host-shape allowlist and YubHub credit are necessary technical
boundaries, not substitutes for this evidence. Keep this hydrated source outside
the initial production proposal until that scope is resolved.

## Teamtailor: documented RSS syndication, employer scope matters

The [RSS guide](https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide)
explicitly describes sending careers-site job data to other systems and promotion
channels. It includes full descriptions, dates, job links, locations, and IDs, and
documents `offset`/`per_page`. This supports actual feed syndication, not merely
public browsing. The collector's Varnish Software sample requires no HTML detail
hydration; production collection can remain RSS-only.

The [customer terms](https://www.teamtailor.com/en-us/terms-and-conditions/), updated
May 2, 2026, §§3, 10, and 14, retain customer content ownership, restrict general
service/material redistribution, and describe customer-directed third-party
integrations. They should not be read as silently banning the specifically
documented RSS channel. They also do not identify every unrelated publisher as a
licensee of every employer's content.

The separate [job-board partner documentation](https://partner.teamtailor.com/job_boards/)
describes partner-specific feeds for employers that activate an integration, with
removal synchronization requirements and an onboarding contact. Those partner
conditions are not automatically requirements for ordinary public RSS consumption;
do not claim partner status or partner-feed completeness for this collector.

**Concrete proposal:** keep only selected employer RSS feeds, record employer
syndication authority/conditions for the activation set, preserve full text and
original job links, and display `Teamtailor` linked to the job URL. That exact
credit is our provenance choice, not a mandatory wording discovered in the RSS
guide. No blanket RSS ban or numeric request-rate allowance was located in the
reviewed documents. Expand employer coverage only with an equally documented scope.

## Release evidence to attach

1. Rendered guest/member job examples proving the Remote Backend Jobs provider
   link and YubHub per-item credit survive storage, hydration, and display. Credit
   links must be visible/clickable wherever the corresponding job content is shown.
2. Exact configured source/tenant/feed scope, conservative request limits, and
   full-text/date preservation tests. Observation caps never prove source closure.
3. For YubHub hydration and Teamtailor employer syndication, the scoped authority
   described above. Preserve any unresolved scope outside activation.
4. Separately attach TEST, isolated database acceptance, deployment/allowlist, and
   owner approval evidence. This publication review does not activate production
   or increase the count of live sources.
