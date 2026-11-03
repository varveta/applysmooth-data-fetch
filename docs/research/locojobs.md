# LocoJobs — public API, no useful US inventory established

Reviewed 2026-11-02. [Official documentation](https://locojob.com/developers) describes free keyless reads at `/api/public/v1/jobs`, `/jobs/{id}` and `/catalog`, including complete descriptions and separate responsibilities, qualifications, benefits and skills. Search is bounded to 20 rows/page and 10 pages; limit 120 requests/minute. Keep provider `url` or `apply_url`; do not cache for long. [Terms section 6](https://locojob.com/terms-of-service) permits public-API searches but excludes dataset resale.

## Read-only observations

- `https://locojob.com/api/public/v1/catalog`: HTTP 200, 8,904 bytes, **1,289 total jobs and 48 advertised cities**, all observed cities in India.
- `https://locojob.com/api/public/v1/jobs?q=United%20States&per_page=3`: HTTP 200, **zero results**. This is a keyword probe, not exhaustive proof that no US listing exists.
- `https://locojob.com/api/public/v1/jobs?per_page=1`: first role `tax-analyst-noida`, explicitly Noida, Uttar Pradesh, India; `posted_date=2026-11-02`, `valid_through=2026-12-17`.
- Detail endpoint: `https://locojob.com/api/public/v1/jobs/tax-analyst-noida`.
- Detail returned HTTP 200, 2,941 bytes: description 733 characters, 4 responsibilities, 3 qualifications, 3 benefits and 3 skills. This confirms sections are available; full original-text comparison was unnecessary after the US/employer blockers.

The sampled remote role is explicitly India-based. Remote status must not imply US eligibility. Its actual employer is confidential: `hiring.type=agency`, agency LocoJobs, `employer=confidential`. Documentation forbids presenting it as employment at an invented named client. This cannot satisfy an employer-preserving US integration by guessing a company.

No adapter added; low priority until useful explicitly US inventory with correct employer identity exists. Samples `/tmp/newsource-locojobs-*`. No registration, outreach, Docker, database writes or production changes.
