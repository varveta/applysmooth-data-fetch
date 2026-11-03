# Online Jobs / ChrisTech — permission and incremental-yield gaps

Reviewed 2026-11-02. [Official developer page](https://onlinejobs.christech.co.ke/developers) advertises free keyless JSON endpoints for external applications, including `/api/remote-jobs`, `/api/search-jobs?query=...` and several job categories. It describes cached responses and recommends caching for at least 5–10 minutes. Commercial/high-volume use is directed to provider discussion.

`https://onlinejobs.christech.co.ke/api/remote-jobs` returned HTTP 200, **72 rows, 485,428 bytes**. Actual source breakdown: **12 Remotive, 60 Arbeitnow**. Zero rows literally stated `United States`, `US` or `USA` in the sampled location field; this limited string check is not final eligibility classification. The first row is a Remotive Worldwide role, with a 44,307-character description and original Remotive URL. The API supplies `date`, but employer-original date provenance/full-text equality were not established.

[Terms sections 5–6](https://onlinejobs.christech.co.ke/terms-and-conditions) restrict redistribution/commercial exploitation without permission. Public read documentation does not establish permission to republish full job descriptions in a commercial catalog. The feed also proxies an existing production source and a previously researched Europe-focused source, so 72 fetched rows are not 72 incremental jobs.

No adapter added. Resume only after applicable reuse permission and useful incremental US coverage are established. Payload `/tmp/newsource-onlinejobs-list.json`. No accounts, provider contact, Docker, database writes or production changes.
