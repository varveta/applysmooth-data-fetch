# Artificial Intelligence Jobs — no full-description API

Reviewed 2026-11-02. Distinct provider `artificialintelligencejobs.co`, separate from AI Dev Jobs at `aidevboard.com`.

[Official developer page](https://artificialintelligencejobs.co/developers) documents free keyless `GET /api/jobs`, combinable filters, offset pagination and a maximum 200 rows/request. Attribution linking the provider is appreciated. [OpenAPI](https://artificialintelligencejobs.co/openapi.json) contains only the search endpoint; no full-job detail endpoint was established.

Read-only `https://artificialintelligencejobs.co/api/jobs?region=US&limit=3` returned HTTP 200, 1,484 bytes: **3 rows, 14,252 matched, 20,233 total live**. First row is Anthropic's AI Outcomes Manager, Strategic Tech (Spanish-speaking), with explicit US locations and `posted=2026-11-02`. Each sampled row includes title, company, location, category, level, salary, provider URL and employer apply URL, but **no description**. Those totals describe provider search results, not accepted unique jobs or proven original dates.

[Terms](https://artificialintelligencejobs.co/terms) prohibit wholesale reposting of its curated dataset as one's own and direct data-use inquiries to the provider. The public API alone neither supplies the required original text nor establishes unrestricted bulk republication. A collector would otherwise need a separate employer hydration layer; that is not implemented here.

No adapter or shared wiring added. Samples `/tmp/newsource-artificialintelligencejobs-*`. No registrations, outreach, Docker, database writes or production changes.
