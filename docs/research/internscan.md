# InternScan

Reviewed 2026-11-02. New distinct platform, **working public US inventory, descriptions missing**.

[Official integration docs](https://internscan.vercel.app/docs/) publish free keyless JSON and RSS for regional trackers and invite university job-board/automation reuse. US endpoint: `https://internscan.vercel.app/us/api/active.json`; global feed: `https://internscan.vercel.app/feed.xml`. Documentation describes the code/database as MIT and lists first-seen/lifecycle fields separately. These are documented export interfaces; no registration is required.

One US JSON request returned HTTP 200, 210,917 bytes, `total_active=401`, and **401 rows with country `us`**. All have employer/title/URL/location metadata; **zero has description/content/full-text fields**. 393 have a `posted` value; this research did not establish its original-employer provenance. Row keys across the entire response: `category`, `city_tag`, `company`, `country`, `first_seen`, `last_seen`, `locations`, `posted`, `region`, `title`, `url`.

Sample: Microsoft, Software Engineer: Security & Identity Intern Opportunities for University Students, Redmond; `United States, Washington, Redmond`; employer URL `https://apply.careers.microsoft.com/careers/job/1970393556922930`; `posted=2026-11-01`, `first_seen=2026-11-02`. This is discovery metadata, not an acceptable full-description catalog row.

Recommendation: useful free source-discovery inventory, but a direct collector would fail required descriptions. Full text would need separately permitted employer/ATS hydration, and many source ATS platforms already exist in ApplySmooth. Do not claim 401 accepted/new jobs or count each employer as another platform. Cached response: `/tmp/50-source-internscan-probe.json`. No adapter or writes.
