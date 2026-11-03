# Niche developer board availability — 2026-11-02

Bounded public checks only. No adapters, accounts, messaging, purchases, Docker or database writes. No access restrictions were bypassed. Language/category pages on one platform count as one source.

| Platform | Primary evidence and ordinary probe | Decision |
| --- | --- | --- |
| DjangoGigs | [Official homepage](https://djangogigs.com/) returned HTTP 200 with its retirement announcement: service ran 2008–2025 and removed postings/user data. | Retired; do not chase old RSS links or directory claims. |
| Golang.cafe | [Official FAQ](https://golang.cafe/faq) says roles are direct submissions and older listings may remain visible after hiring ends. Homepage GET returned HTTP 429; stopped. Search-index evidence showed recent Europe roles but US examples from June/August. | No successful public feed/API contract, full payload or fresh US yield established. Do not retry around rate limits. |
| Ruby on Remote | Ordinary GET to [official homepage](https://rubyonremote.com/) returned HTTP 403. | Stopped; no alternate browser/proxy/header access attempts. Feed/full text/date/rights unverified. |
| RubyNow | `https://www.rubynow.com/` failed TLS hostname verification. Publicly referenced `https://jobs.rubynow.com/` failed because its certificate expired. | Stopped; TLS validation was not disabled. No valid feed contract or live job counts established. |
| ReactJobsBoard / TRYremote | `https://reactjobsboard.com/` returned 301 to [TRYremote](https://tryremote.com/). Destination returned HTTP 200; no RSS/API link found in homepage. [Terms](https://tryremote.com/terms-of-service) permit temporary personal/noncommercial viewing and restrict broader copying. | Same redirected platform, not two sources. Bulk full-description catalog reuse not established. |

More promising results from this batch have separate notes: [Python.org](pythonorg-jobs.md) has a contributed-content reuse grant but currently weak fresh US inventory; [Getwork](getwork.md) has full-detail API/date proof and a TEST-only collector, while republication scope remains unresolved.
