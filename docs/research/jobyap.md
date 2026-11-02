# JobYap

Reviewed 2026-11-02. New distinct candidate, **documented public API, live access blocked**.

[Official publisher API reference](https://github.com/jobyap/agent-skills/blob/main/skills/jobyap/references/api.md) documents unauthenticated GET endpoints under `https://jobyap.com/api/v1`, including `/jobs`, `/jobs/{numeric-id-or-slug}`, `/locations`, and `/companies`. Search has explicit country identifiers, 1–50 records/page, opaque cursors, and original-publish filtering (`posted_within`). Detail supplies full Markdown, employer application URL, salary, and location. Nullable `posted_at` must remain unknown. Canonical provider URLs identify postings and should be retained as attribution.

One ordinary request to `https://jobyap.com/api/v1/jobs?location=country-US&posted_within=7d&page_size=20` returned **HTTP 403**. Stopped without header tricks, alternate hosts, account creation, or access bypass. Live sampled/accepted rows: zero; US inventory and original-date/full-description parity remain unmeasured. Official homepage's aggregate inventory is a publisher claim, not our acceptance measurement.

[Terms](https://jobyap.com/terms-of-service) describe aggregation of employer postings and user discussion. They do not supply an explicit downstream commercial job-republication grant. MIT licensing of the publisher's agent integration code does not establish a license to employer job descriptions.

Recommendation: retain as high-potential research candidate. Revisit only when ordinary documented API access works; then sample detail records and resolve commercial display scope. No adapter or production-ready count yet.
