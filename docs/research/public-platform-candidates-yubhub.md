# Additional public job platforms — 2026-11-02

Candidates below were checked against the expansion tracker before research. Existing JOIN, Comeet and JazzHR decisions were not counted again. No accounts, contact, credentials, purchases, production writes or local Docker were used.

| Platform | Public access / measured US inventory | Decision |
| --- | --- | --- |
| SpaceJobs.Now | One public XML page: 600 jobs; header 15,046 / 26 pages. Two original employer full-text comparisons passed. | Implemented experimental bounded collector; [evidence and limits](spacejobs.md). |
| Peopleseek Talent | Public JSON, no key. US search returned 7,308 total and three sampled Lyft jobs. Detail endpoint supplies full description. | Strongest technical follow-up; source-specific reuse obligations remain. No adapter created. |
| Jobico | Public XML, 333 jobs / 1,017,273 bytes. Five explicit US locations. | Limited fresh US yield; conflicting general terms need resolution before implementation. |
| Job Boardly | Official public XML/RSS distribution feature; concrete live feed attempts blocked. | Platform viable in principle, no verified public employer/board target yet. |
| Let's Employ / oJobPub | Open employer-published standard, but directory export/explorer redirected to login. | No authenticated access attempted; no real US full-text sample established. |

## Peopleseek Talent

[Official API docs](https://jobs.peopleseek.ai/developers/api) describe free unauthenticated access, 120 requests/minute/IP, cursor pages up to 100, full details and source attribution. Republishing inherits upstream source terms; displayed verification time is also required. This is not an independent blanket license for every upstream source.

Measured `GET https://jobs.peopleseek.ai/api/v1/jobs?country=US&limit=3`: HTTP 200, 5,896 bytes, total 7,308. Search entries are summaries; full text requires detail hydration. Sample detail `/api/v1/jobs/34d45a8a-71ca-4ebd-bb97-8d8340827a20` returned 4,771-character HTML / 4,421-character text and Seattle, WA, US. Source/apply URL: `https://app.careerpuck.com/job-board/lyft/job/8916983002?gh_jid=8916983002`.

Comparison with [original Lyft job 8916983002](https://boards-api.greenhouse.io/v1/boards/lyft/jobs/8916983002) found identical normalized words, with HTML entity differences only. Original publication `2026-11-02T13:36:10-05:00` equals provider `2026-11-02T18:36:10.000Z`. Caches: `/tmp/peopleseek-detail.json`, `/tmp/peopleseek-original-lyft.json`. No claim of full-corpus permission or original-date correctness beyond this sample.

## Jobico

[Official developer page](https://www.jobico.io/en/developers) advertises XML for aggregators at `https://jobico.io/api/feeds/jobs.xml`, employer-written text, 30 requests/minute/IP and original Jobico backlinks when republishing. [Terms](https://www.jobico.io/en/terms), updated October 17, separately permit platform-controlled distribution while withholding third-party scraping/extraction rights and prohibiting automated extraction. The public feed invitation and general restrictions were recorded, not silently treated as a complete reuse clearance.

Cached `/tmp/jobplatform-jobico.xml`: five US jobs dated September 2–8, 2026; description lengths 383–2,679 characters. None has a stated date within 15 days of this check. No employer full-text comparison completed. They are not five ready fresh jobs. No adapter created.

## Additional concrete leads and blockers

- [Job Boardly feed documentation](https://help.jobboardly.com/en/articles/9664028-how-to-use-rss-feeds-and-xml-feeds) explicitly supports syndication through `/jobs.xml` and `/jobs.rss`; board owners can disable access. `https://pennsylvania-communications.jobboardly.com/jobs.xml` and `https://www.trustandsafetyjobs.com/jobs.xml` returned access failures, ultimately 403. No bypass attempted. Trust & Safety's public page does not prove access to its gated listings.
- [Let's Employ](https://www.letsemploy.org/en/) documents employer-hosted `/.well-known/ojobpub.json` for external discovery. Description is optional; schema licensing alone does not license every employer's content. `https://sources.letsemploy.org/exports/download-latest` and its documented explorer redirected to login. No account created.
- [JobDataAPI](https://jobdataapi.com/docs/) anonymous access is restricted testing, not a verified free production feed; sample endpoint returned 403.
- [ApplicantStack API](https://www.applicantstack.com/workforcehub-university/api-integration-guide/) requires private credentials. No intended unauthenticated export established.
- [CareerPlug XML setup](https://partnersupport.careerplug.com/setting-up-and-managing-xml-feeds) requires partner/customer provisioning. No public export established.
- [JOBnaru API](https://jobnaru.com/en/api) free use is personal/research; commercial redistribution requires separate licensing. Not counted as a free production candidate.
