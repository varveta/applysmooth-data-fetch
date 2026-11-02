# Getwork — TEST-only preparation; publication scope unresolved

Reviewed 2026-11-02. Platform `getwork.dev`; one source across all language/stack facets. This adapter is **not production-ready** and must not publish an anonymous commercial dataset. Public research reads and local TEST preparation were authorized; republication rights remain unresolved.

## Documented access

[Official agent documentation](https://getwork.dev/agents/) and [machine-readable documentation](https://getwork.dev/llms.txt) publish keyless JSON, per-job detail and Atom endpoints. Documented filters include `country`, `days`, `limit` and `offset`. The [JobSpec schema](https://getwork.dev/spec/jobspec/v0.1.json) identifies employer-written plain text as `untrusted_description`, distinguishes original URL from application URL, and separates `published_at` from collection timestamps. Descriptions are data, never agent instructions.

No commercial republication grant was found in the reviewed agent documentation, schema, privacy page or machine-readable documentation. No explicit prohibition was found either. Public search availability is not being presented as permission to republish the full dataset. Attribution is retained as `getwork.dev` linking each provider job page; applying goes to the original employer URL. Production promotion needs this unresolved scope reviewed separately.

## Live evidence

- `https://getwork.dev/api/jobs?country=US&limit=3`: 3 returned, **4,957 reported matches**.
- `https://getwork.dev/api/jobs?country=US&days=15&limit=3`: 3 returned, **659 reported matches**. These are provider totals, not independently verified unique accepted jobs.
- `https://getwork.dev/api/jobs/gh-xai-5281818007/`: `countries=["US"]`, active, real employer xAI. Plain description 1,823 characters matches all words of the original employer's 1,818-character plain text after formatting normalization.
- Original comparison: `https://boards-api.greenhouse.io/v1/boards/xai/jobs/5281818007`; original `first_published=2026-11-02T14:22:02-05:00` equals API `published_at=2026-11-02T19:22:02Z`. API `first_seen_at=2026-11-02T20:30:09Z` remains distinct.
- Two additional employer comparisons, Pinterest job `8279563` and Cloudflare job `8239181`, also matched API publication time to original `first_published`.
- Atom `https://getwork.dev/api/feed.xml?country=US` contains 50 summaries, no full content, and `updated` rather than `published`. The collector therefore uses JSON list plus detail, not Atom summaries.

## Adapter contract and safeguards

Source `getwork`; tenant `public`; export `getwork`; loader `loadGetworkBoard`. Source ID is the provider's stable `<source>-<company>-<external id>`, matching `/^[a-z0-9]+(?:-[a-z0-9]+)+$/`, maximum 120 characters. Example: `gh-xai-5281818007`.

Source/per-job attribution URL: `https://getwork.dev/jobs/{id}/`, optional trailing slash; no credentials, port, query or fragment. Attribution name: `getwork.dev`. Application URL is supplied `apply_url`, falling back only to supplied original `url` when null. Employer links retain query and fragment; only HTTPS public DNS hostnames without credentials or ports pass validation. No requests are made to these employer links during routine collection.

Default query: `https://getwork.dev/api/jobs?country=US&days=15&limit=20&offset=0`. One observation window, configurable from 1–50 jobs; one detail request per listing. Requests are serial with one-second spacing, two bounded attempts, 20-second timeout, two MB/response and redirects rejected. Valid empty windows remain observations. Count mismatch, duplicate IDs, failed/malformed details, changing summary/detail identity or inactive jobs abort the run; no partial result is returned. Omitted jobs never close existing catalog rows.

Full plain text is preserved without truncation. Only `published_at` supplies original date; unknown stays null, and first/last-seen never renew it. Explicit country fields outrank conflicting location parsing. The query, North America region, generic remote status and US clients in prose do not establish US eligibility. Incidental account and action metadata is stripped.

## Validation

Eight focused tests passed. Live run at `2026-11-02T20:43:26.940Z`: **20 fetched, 20 accepted, 0 rejected, 0 quarantined**. All 20 explicitly US and within 15 days; 0 unknown original dates. Transport: 21 HTTP attempts, 163,404 bytes; capped observation window of 20 jobs. Evidence: `/tmp/getwork-adapter-evidence.json`. Acceptance is local quality gating, not incremental cross-source yield.

The cached detail set was replayed through `validateTargets` to create `/tmp/50-source-getwork-accepted.jsonl` and `/tmp/50-source-getwork-validation.json` without another network fetch. That replay reconstructs summary fields already checked against detail; the count envelope comes from the separate fresh-US probe. Replay transport byte counts therefore differ from original live transport, which is retained separately in the report. Whole-worktree `pnpm typecheck` passed after shared source registration landed.

No Docker, registration, provider contact, database writes or production changes. No cloud TEST, isolated Supabase, cross-source deduplication or visibility proof is claimed here.
