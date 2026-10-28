# Source validation — October 28, 2026

All 12 source pipelines passed live-feed dry runs. These results validate fetch, normalization and publication gates; they do not claim rows were written to Supabase.

| Source | Boards/feeds | Fetched | Accepted | Seconds |
|---|---:|---:|---:|---:|
| ashby | 10 | 2395 | 893 | 19.8 |
| greenhouse | 22 | 8841 | 3228 | 85.7 |
| lever | 5 | 1919 | 531 | 25.9 |
| smartrecruiters | 2 | 1285 | 253 | 153.6 |
| workable | 2 | 10 | 4 | 0.5 |
| personio | 1 | 4 | 0 | 0.6 |
| recruitee | 2 | 97 | 5 | 1.4 |
| jobicy | 1 | 731 | 731 | 80.1 |
| himalayas | 1 | 80 | 80 | 2.4 |
| weworkremotely | 1 | 94 | 83 | 2.7 |
| remoteok | 1 | 99 | 8 | 74.6 |
| remotive | 1 | 10 | 9 | 0.3 |

Total: 15565 fetched; 5825 accepted. Counts can change between runs. Personio currently has no fresh US jobs; this is expected, not a pipeline failure.

Workable country variants are merged only when non-location data agrees. One conflicting We Work Remotely GUID is withheld; unrelated postings continue. Unknown US eligibility, old postings and insufficient descriptions remain gated. Provider restrictions and operational limits are documented in SOURCE_PIPELINES.md.

Validation: 309 automated tests and TypeScript checks passed. Original three-source behavior, observation-only closures, expiry, pagination failures, malformed feeds, independent activation and cached daily verification are covered.
