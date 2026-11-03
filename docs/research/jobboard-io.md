# JobBoard.io

Reviewed 2026-11-02. New distinct platform; **public-feed capability documented, sample blocked**. Count customer boards as tenants, not separate source integrations.

[Official RSS integration instructions](https://support.jobboard.io/docs/embed-jobs-feed-into-an-existing-website-via-rss) describe syndicating jobs through `https://{board}/jobs.rss` into another website. This confirms an intended public-feed surface; the document addresses board owners and does not itself grant unrestricted reuse of every customer's content. The separate [JSON jobs API](https://support.jobboard.io/reference/api-explore-get) requires the owning account's `X-Api-Key`; it is not an anonymous alternative.

Public search found a real US customer, School Driver Jobs: [Par Logistics role in Tampa](https://schooldriverjobs.jobboard.io/jobs/636783084-logistics-account-manager-at-par-logistics), published November 1, 2026, full description visible in search. One request to the documented customer feed `https://schooldriverjobs.jobboard.io/jobs.rss` returned **403**. Stopped without alternate headers/paths or bypass. Feed records inspected: zero. Full feed descriptions, fields, dates, and accepted US yield remain unverified.

[Official case studies](https://jobboard.io/case-studies/) identify additional real customer organizations including Hire Heroes USA, AACR CancerCareers, AACC, and TDWI. These are possible future targeted feed checks, not verified live feeds. No guessed-domain enumeration was performed.

Recommendation: retain as public-feed research candidate. Need one normally accessible, customer-authorized full-description feed and original-date/location evidence before building an adapter. Do not use the authenticated JSON API or create an account for this task.
