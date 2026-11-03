# CuratorSearch — full-text republication restricted

Reviewed 2026-11-02. [Official developer documentation](https://curatorsearch.com/developers) provides keyless JSON search, per-slug detail, and RSS. Public search supports `q`, `category`, `region` and `limit` up to 20; clients should identify their project and respect rate limits.

Read-only probe `https://curatorsearch.com/api/jobs?limit=3` returned HTTP 200, 990 bytes, **3 results and 291 total**. One sampled result explicitly states `New York, USA`, employer `MoMA PS1`, and posted date `2026-11-02`. Original date provenance and full-description comparison were not pursued after the permission blocker appeared. Detail pattern is `/api/jobs/{slug}`; permanent role links use `/opportunities/{slug}`. RSS: `https://curatorsearch.com/feed.xml`.

The official documentation explicitly directs users to link to job pages instead of republishing descriptions. Its CC BY 4.0 grant covers the pay archive and hiring index, **not job descriptions**. Bulk republication is blocked; a separate keyed partner feed exists. Consequently public search access does not authorize ApplySmooth's full-description catalog ingestion.

No adapter added. Resume only if applicable publication rights and full-feed access become available. No provider contact, registration, database writes, Docker or production changes. Probe payload: `/tmp/newsource-curatorsearch-list.json`.
