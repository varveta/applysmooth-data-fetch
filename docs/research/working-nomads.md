# Working Nomads — reuse blocker

Checked 2026-11-02; absent from source tracker before review. No adapter proposed.

One ordinary unauthenticated GET to `https://www.workingnomads.com/api/exposed_jobs/` returned HTTP 200, JSON, 169,590 bytes and 35 entries. No key, cookie, account or bypass was used. The response has no pagination envelope or separate ID field. Each entry contains `url`, `title`, `description`, `company_name`, `category_name`, `tags`, `location` and `pub_date`.

Measured fields:

- 35 unique URLs; all sampled rows had company and date values.
- Raw description lengths 770–6,096 characters. These lengths do not prove original completeness; employer comparisons were not performed after the reuse blocker was established.
- 12 locations explicitly mention US, USA, United States or U.S. This is a location-marker count, not an accepted-job count. Four say Global, one North America and fifteen CET/time-zone variants; none of those alone proves US hiring eligibility.
- Example `https://www.workingnomads.com/job/go/1981017/`: Lemon.io Senior Magento Developer, location including U.S., `pub_date=2026-10-29T09:50:51-04:00`, description 5,002 characters. The numeric redirect-path component is a possible provider ID, but stability has not been documented or verified.

[Official terms](https://www.workingnomads.com/terms-and-conditions), last updated March 11, 2025, apply to free access too. Sections 3.1(b) and 3.1(d) restrict commercial exploitation and building competing products/services. Reviewed official homepage navigation and search results did not establish a publisher syndication exception or current API documentation granting commercial republication. Third-party API directories are not permission from Working Nomads.

Implementation is held under the current source-reuse criteria. Before reconsideration, establish applicable feed permission, complete original employer descriptions, date provenance and the identity behind application redirects. Do not claim this unpaginated response is a full corpus or infer closure from absence. Do not substitute `pub_date` for employer publication time without evidence.

Cache: `/tmp/research-workingnomads-api.json`. No further feed traversal, registrations, provider contact, Docker, database writes, production changes or commits.
