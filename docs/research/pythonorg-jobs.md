# Python.org jobs — reuse grant, but weak current fresh US yield

Reviewed 2026-11-02. The [official board](https://www.python.org/jobs/) links `https://www.python.org/jobs/feed/rss/`. [Submission instructions](https://www.python.org/community/jobs/howto/) describe publishing accepted employer posts on the website and RSS; submissions are moderated and expire after three months.

[Legal statements, Third-Party Content](https://www.python.org/about/legal/) grants website users worldwide, royalty-free rights to reproduce, distribute, display and publish contributed content. This is stronger reuse evidence than merely finding a public URL; it is separate from the Python software license.

## Bounded public observations

RSS returned HTTP 200, **20 items, 55,121 bytes**. Every item has title, link, description and GUID; **zero `pubDate` values**. A full-description collector also needs public detail pages because RSS omits separate requirements/company/contact sections.

`https://www.python.org/jobs/8195/` exposes full sections and `<time datetime="2026-10-28T08:55:19.214015+00:00">`, but job location is only `Remote, Remote`; employer UNICEF does not imply US eligibility. `https://www.python.org/jobs/8174/` exposes original October 12 time and full sections. Its headline says Tallinn, Estonia while the description explicitly says USA/LATAM remote; country handling would need to distinguish advertised work eligibility from employer location. It is already older than 15 days.

The current feed's explicitly US headline location is Softech Associate in Panama City Beach, Florida, posted August 16, beyond the ordinary 60-day gate. Recent US roles seen in search caches at `/jobs/8181/` and `/jobs/8177/` now both return **404**; stale search results must not be resurrected. Generic Worldwide/Remote rows were not counted as explicit US jobs.

No adapter added. Technically feasible approach: bounded RSS discovery plus same-host numeric `/jobs/{id}/` details, preserve original `<time>`, whole job-description section, employer identity and provider backlink. Snapshot absence must remain observation-only. Current useful fresh US acceptance was not established, so this remains a lower-priority candidate rather than a new production-ready source.

Samples `/tmp/niche-python*`. No accounts, outreach, Docker, database writes or production changes.
