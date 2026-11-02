# Initial public-feed activation proposal

Prepared November 2, 2026. **Proposal only: no activation, manual production-writer
deployment, migration, environment change, shared database write or schedule change
has been performed.** The existing Vercel Git integration automatically created
the feature Preview deployment documented below; that is not writer activation.

Initial scope is **SpaceJobs.Now and Rails Job Board**, one `public` board each.
Get on Board is documented as a conditional follow-on, not included in the initial
activation. All other new sources remain TEST-only. This proposal is ready for
review; execution still requires final passing evidence and owner approval.

## Evidence and remaining blockers

| Source | Publication basis | Latest relevant evidence | Initial disposition |
| --- | --- | --- | --- |
| `spacejobs` | [Publisher feed guidance](https://spacejobs.now/job-feed) expressly supports job-board republication of full descriptions; preserve the complete feed URL in both listing and Apply links. | [Cloud source/link run 41523776620](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41523776620) passed with 595 accepted jobs. All posting dates remain unknown because the feed mixes publication and first discovery. | Source/link checks passed; corrected isolated backend acceptance pending. |
| `railsjobs` | [JobKit](https://www.jobkit.io/) describes RSS use by aggregators and automations; [Rails Foundation](https://rubyonrails.org/2023/11/27/rails-job-board-is-live) identifies the board and RSS channel. | [Cloud source/link run 41523776620](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41523776620) passed with 7 accepted jobs; cached sample had 1 accepted with original date within 15 days. US working hours/time zones do not establish eligibility; contradictory US exclusions quarantine the listing. | Source/link checks passed; corrected isolated backend acceptance pending. |
| `getonboard` | [Official API guidance](https://www.getonbrd.com/help/what-can-i-do-with-get-on-board-s-api) permits external listings and custom job boards. | [TEST run 41523776620](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41523776620), job `125546338524`: first API request returned HTTP 403, after an earlier pass in run `41520833751`. | **Blocked: hosted access is intermittent/unresolved. No retry, alternate endpoint or proxy bypass.** |

Get on Board needs a supported, reliable access path from the approved hosted
runner before its separate proposal can proceed. Publication permission alone
does not establish hosted access. Remote Backend Jobs remains deferred after its
separate hosted HTTP 403 and is outside both proposals.

The latest audited backend candidate is `00f018357b05af7f2ce48cbec58767904c93c828`, pinning
collector `ce8f183152a832deea4136306b95114ba9b9bd9a` in the ten-source acceptance
manifest at that checkpoint. The next selected manifest has nine sources,
explicitly excluding Remote Backend Jobs and Get on Board after hosted 403s.
[Full backend CI 41524185960](https://github.com/Sathvik-Chowdary-Veerapaneni/applysmooth/actions/runs/41524185960)
passed; isolated run `41524186125` encountered a test-harness large-GET-read issue
and is not passing acceptance evidence. SpaceJobs and Rails source/link jobs
passed in run `41523776620` with 595 and 7 accepted jobs. The corrected isolated
acceptance run remains pending at this checkpoint. These are checkpoints, not approved release pins. Record final full
commit SHAs and passing source/link, full backend CI/build and isolated
HTTP/Supabase run URLs before execution. A combined run that stops at Get on
Board's 403 is not passing backend evidence for the initial pair; the coordinator
must use an explicitly scoped manifest and retain the failure record.

Read alongside collector [SpaceJobs research](../research/spacejobs.md),
[Rails research](../research/rails-jobs.md), [Get on Board research](../research/getonboard.md)
and backend `docs/runbooks/experimental-job-source-rollout.md` and
`docs/runbooks/job-source-expansion.md`.

## Exact proposed source changes

[initial-source-activation.patch](initial-source-activation.patch) contains the
future diff for the initial pair. It changes nine files: a small approved-feed
registry, the source pipeline and stateless writer guards, the live verifier
entry guard, pipeline tests, dedicated activation tests, two independent workflows
and `sources.json`.
`git apply --check` passed against the current collector worktree. Applied only
to a disposable filesystem copy of the current collector, it passed **all 504
tests across 36 files, plus typecheck**: the existing 474 checks and 30 proposal
checks. Seventeen dedicated tests exercise approved sources through all three
entry guards, publication acknowledgements, live verification without TEST opt-in,
all other nine experimental IDs blocked before requests, cached observation
absence remaining uncertain, changed application URLs and changed US eligibility.
Thirteen additional pipeline/config checks cover explicit runtime activation and
the independent workflows. The conditional follow-on patch also
passed its application check after this initial patch in that copy. No actual
source/config file was changed, no provider was fetched and no database was
written by these checks. Reviewed initial patch SHA-256:
`e20e757cfccd26205b74c28b7f8e774e26c4199c7279f1c76d75cdc1b3b60b4b`.
Recheck patch applicability against the final release SHA before execution.

Keep all IDs in `EXPERIMENTAL_SOURCE_IDS`: the backend also uses that collection
to enforce strict per-source URL/credit rules and prohibit legacy publication.
Removing IDs there would weaken a contract, not just activate a source. Instead,
the collector's new `APPROVED_PUBLIC_FEEDS = ["spacejobs", "railsjobs"]` allows
only these feeds through the three live entry guards. `JOBS_ACTIVE_SOURCES`
remains a separate required runtime switch. Existing strict observed-application
URL checks and observation-only verification remain in place.

Do not add these feeds to legacy `ingest/config/targets.json` or `collector.yml`.
Their independent source workflows call the existing `source-pipeline.yml`.

| Source | Exact target | Proposed UTC cron | Listing, Apply and visible credit |
| --- | --- | --- | --- |
| `spacejobs` | `{"source":"spacejobs","tenant":"public","company":"SpaceJobs.Now"}` | `37 6 * * *` | All three URLs equal the untouched feed URL, including exactly `?utm_source=job-feed&utm_medium=job-feed&utm_campaign=us`; credit `SpaceJobs.Now`. |
| `railsjobs` | `{"source":"railsjobs","tenant":"public","company":"Rails Job Board"}` | `42 6 * * *` | All three URLs equal `https://jobs.rubyonrails.org/jobs/{positive-numeric-id}-{lowercase-hyphen-slug}`; no trailing slash/query/hash; credit `Rails Job Board`. |
| `getonboard` — conditional only | `{"source":"getonboard","tenant":"public","company":"Get on Board"}` | `32 6 * * *`, only after separate clearance | All three URLs equal `https://www.getonbrd.com/jobs/{observed-id}`, optional trailing slash; credit `Get on Board`. |

These configured company labels describe the feed. Published employer names come
from each posting. The cron is fixed UTC; GitHub queueing can delay execution.
Shared `collector-online` concurrency serializes the source jobs. Verification
remains the existing daily `06:47 UTC` workflow; its separate concurrency group
means it can overlap a delayed collection. Existing database leases and replay
checks continue to apply.

## Polling and verification budgets

Daily source collection plus one existing daily verification sweep are the
initial budget. Verification caches each board observation across its batches.
No extra scheduled probes, bulk manual verification, or full-corpus crawling.

| Source | Collection window and limits | Maximum feed/API requests per day, collection + one verification sweep |
| --- | --- | --- |
| SpaceJobs.Now | US page 1 only, at most 600 rows, 20 MB response, 30-second collection timeout. One retry only after a retryable failure, waiting 60 seconds. | Normally 2 observations; at most 4 HTTP attempts. The loader's explicit delayed retry can also apply during verification. |
| Rails Job Board | One RSS window, at most 1,000 rows, 12 MB, 20-second collection timeout; at most two collection attempts. | Normally 2; at most 3 attempts because verification overrides the shared request helper to one attempt. |
| Get on Board — blocked | Search `United States`, 10 rows/page, at most 25 pages/250 rows; serial requests with one-second page spacing; 12 MB/page, 20-second collection timeout, two attempts/page. | If separately approved: at most 50 collection + 25 verification requests. This is an internal ceiling, not a published provider allowance. |

Verification overrides network timeouts to 15 seconds. It checks application
links only after the current source observation confirms the same ID, US
eligibility and unchanged application URL. Missing records are uncertain, never
closed. Application checks are additional GETs, with up to five redirects
(six requests per confirmed job), no retry loop, global concurrency 8 and
per-host concurrency 4. The daily queue is bounded to 20 batches of 500 jobs.
For these unique-ID windows, no more than 600 SpaceJobs / 1,000 Rails / 250
conditional Get on Board records can receive a confirmed-source link check per
cached sweep: worst-case redirect ceilings are 3,600 / 6,000 / 1,500 requests.
These are upper bounds, not expected traffic or requests-per-minute guarantees.
Normal source collection does not fetch application pages or hydrate details.

SpaceJobs asks for one to a few feed polls daily; the two normal observations fit
that scope. Its prescribed retry delay is retained. Neither reviewed Rails nor
Get on Board documentation supplied a numeric application-page rate allowance.
Watch actual 429/403 responses and request counts; pause affected collection and
remove its verification scope if access becomes unsupported. Do not increase
polling or change endpoints to work around a refusal.

Every feed stays `snapshot_mode = 'observation_only'`. Empty/capped results,
changed eligibility, failed pages and absence cannot close jobs. Keep original
publication dates: Rails `pubDate`, Get on Board `published_at`, SpaceJobs null.
Do not relabel unknown SpaceJobs dates as fresh. Apply existing 15-day catalog
visibility, guest delay, expiration and closure policies unchanged.

## Current read-only configuration audit

Audited November 2, 2026 at approximately `21:13 UTC`. Machine-readable,
nonsecret evidence: [initial-source-configuration-audit.json](initial-source-configuration-audit.json).
Only selected settings, metadata, counts and definition hashes are retained.
No credentials, environment dumps, job descriptions or private applicant data.

- Vercel project `applysmooth`, ID `prj_8IuYGMTJAxHUrhafvIfApYDX1Lor`, team
  `team_suA7n06vMkAL0E7g3933FlPS`, scope `abhinaya-veerapaneni-s-projects`.
  Connected repository is `Sathvik-Chowdary-Veerapaneni/applysmooth`; production
  branch is **`PROD`**. Node is `24.x`.
- The `TEST` Preview alias is
  `applysmooth-git-test-abhinaya-veerapaneni-s-projects.vercel.app`. It currently
  maps to READY deployment `dpl_JoDn6hPJnf41q9H4rJo6xuiR5g1x`, URL
  `https://applysmooth-7qy70rq3i-abhinaya-veerapaneni-s-projects.vercel.app`, SHA
  `ef0400472e1c416a3a7ded2826ce7dbf371316d9`.
- The candidate feature branch already has READY Preview deployment
  `dpl_AztD5CQbCPPeWq9e35MpX8anYWfh`, URL
  `https://applysmooth-rndtarf8b-abhinaya-veerapaneni-s-projects.vercel.app`, at
  backend SHA `00f018357b05af7f2ce48cbec58767904c93c828`. READY means deployed;
  it does not prove that production collection uses this deployment.
- Generic Preview settings are `JOBS_COLLECTOR_ENABLED=true`,
  `JOBS_COLLECTOR_ALLOW_SHARED_DB=qhilcyvwvesqfuykdows` and
  `NEXT_PUBLIC_SUPABASE_URL=https://qhilcyvwvesqfuykdows.supabase.co`.
  No `JOBS_COLLECTOR_ISOLATED_TEST` project variable was present. The generic
  Preview board allowlist is **only `ashby:openai`**. `TEST` has a separate,
  sensitive `JOBS_COLLECTOR_BOARDS` override; its value is not readable through
  the supported API. Do not mistake the generic value for the live allowlist or
  deploy a replacement writer with just that value.
- GitHub repository `varveta/applysmooth-data-fetch` is owned by a **User**, not
  an organization, and defaults to `main`; organization variable inheritance is
  inapplicable. The `test` environment has zero variables. Therefore the effective
  values are the repository variables below; both still have October update dates.
- `COLLECTOR_ENDPOINT`, `COLLECTOR_TOKEN` and `COLLECTOR_VERCEL_BYPASS` exist as
  `test` environment secrets, with no repository-level counterparts. Endpoint
  metadata was last updated `2026-10-28T04:44:03Z`; token and bypass metadata were
  last updated `2026-10-24T16:07:45Z`. Secret **values were not requested**.
  GitHub does not expose the endpoint value for readback. No selected local
  `COLLECTOR_ENDPOINT` copy was found, so the current endpoint binding remains
  unproven; the verified TEST alias above is not asserted to be that secret.

Effective repository variables:

```json
{
  "JOBS_ACTIVE_SOURCES": ["ashby", "greenhouse", "lever", "smartrecruiters", "workable", "personio", "recruitee", "jobicy", "himalayas", "weworkremotely", "remoteok", "remotive"],
  "JOBS_SOURCE_NOT_BEFORE": {"jobicy": "2026-10-28T05:30:00Z", "remotive": "2026-10-29T04:30:00Z"}
}
```

Both cooldown timestamps have elapsed. Neither initial source is active. Preserve
repository variable scope in the future commands; do not create a `test` variable
override that silently shadows later repository changes.

Hosted Supabase `qhilcyvwvesqfuykdows` has **86 migration records**, latest version
`20261028135055` (`job_catalog_renew_on_reseen`). For **each** of `spacejobs` and
`railsjobs`, all-tenants catalog rows, public catalog rows, tombstones, identities,
aliases, seeds, boards and run counts are **zero**. Globally unmapped tombstones
are also **zero**. The expansion version and new attribution constraint are absent.
These are present database facts; recheck them immediately before seeding and
retain the separate historical-ledger review requirement.

Migration version numbers differ from local filenames:

| Migration | Hosted version | Repository version |
| --- | --- | --- |
| `job_source_expansion` | `20261028042755` | `20261028020000` |
| `job_verification_retry_cooldown` | `20261028043706` | `20261028030000` |
| `job_collector_shared_lease_lock` | `20261028050721` | `20261028040000` |
| `job_catalog_renew_on_reseen` | `20261028135055` | `20261028140000` |

This does **not** imply missing functionality. Read-only `pg_get_functiondef`
comparison found exact body equality with the latest pre-expansion repository
definitions for `job_collector_source_supported(text)`,
`job_collector_verify_queue(integer,text[])`,
`job_collector_verify_results(uuid,jsonb,text[])` and
`job_collector_lifecycle_run(boolean,text[])`. Their execute ACLs are restricted
to `postgres` and `service_role`; the last three remain security definers. The
proposed copied bodies differ only in their permitted source lists. Definition
MD5s and body SHA-256s are recorded in the evidence JSON. No baseline repair or
historical migration rewrite is needed for this proposal.

The Vercel connector could inspect deployments but returned 403 for environment
metadata. Its documented same-project CLI fallback succeeded; only the selected
nonsecret settings above were read. A runtime log check found no matching groups
within the supported 55-minute window. Hobby retention rejected a 24-hour runtime
query, so this is not proof of no collection or evidence tying the endpoint secret
to a deployment. No access bypass, new token or share link was created.

## Remaining release values

| Value | Required result |
| --- | --- |
| Collector release SHA / backend release SHA | Final reviewed full SHAs with passing current evidence; the proposal patch requires its own validation. |
| Existing Vercel writer project, scope and deployment | Project/scope and TEST mapping verified above. Confirm the actual endpoint-secret binding and preserve that working URL for rollback. No new project or account. |
| `COLLECTOR_ENDPOINT` | Actual value is write-only in GitHub. Recover it from an existing authorized private configuration record; do not guess from the TEST alias or extract it through a workflow/log. |
| Writer credentials / protection bypass | Existing matching `COLLECTOR_TOKEN` and backend `JOBS_COLLECTOR_TOKEN`; existing project protection bypass if required. Preserve securely; never print values or commit them. |
| Backend exact board allowlist | TEST override exists but is unreadable because it is marked sensitive. Recover the approved value from its existing private record, then append only `spacejobs:public,railsjobs:public`. Preserve every existing entry; do not substitute generic `ashby:openai`. |
| GitHub effective variables | Repository values verified above; environment has no overrides and owner is not an organization. Recheck immediately before editing. |
| Database migration head and identity history | Verified above: historical version drift, exact copied-function baseline parity, both sources empty, zero unmapped tombstones. Recheck before mutation; no `db push` or history repair. |

The existing writer deliberately uses `VERCEL_ENV=preview` against the shared
production database. Production activation does **not** mean changing that
guard to `production`. Required existing settings are:

```text
JOBS_COLLECTOR_ENABLED=true
NEXT_PUBLIC_SUPABASE_URL=https://qhilcyvwvesqfuykdows.supabase.co
JOBS_COLLECTOR_ALLOW_SHARED_DB=qhilcyvwvesqfuykdows
SUPABASE_SERVICE_ROLE_KEY=<existing secret>
JOBS_COLLECTOR_TOKEN=<existing secret>
JOBS_COLLECTOR_ISOLATED_TEST=<unset or false>
```

Do not change reader scope to make an import tool run. The isolated CI switch
cannot authorize a hosted production database. Preview and TEST labels do not
make writes to this database harmless.

## Ordered execution after approval and final passing evidence

### 1. Prepare reviewed collector release without activating variables

From a clean branch based on the final reviewed collector head, apply only the
initial patch, inspect it, then run normal checks:

```sh
git apply --check docs/rollout/initial-source-activation.patch
git apply docs/rollout/initial-source-activation.patch
git diff --check
pnpm test
pnpm typecheck
```

The focused coverage above is already included in the patch and passes with the
full suite and typecheck. Current source TEST has passed both proposed providers.
Retain the final corrected disposable backend acceptance evidence with the reviewed
scope and no shared database credentials: counts, dates, permissions,
insertion/replay and visible-credit checks. No implementation/test work is deferred
to approval; cloud acceptance and the two unreadable configuration values remain
explicit external prerequisites.

The proposed workflow files contain schedules. Merge only after backend and
runtime prerequisites below are ready, or immediately disable these new
workflows before their first scheduled time. Even unactivated `auto` jobs fetch
in dry-run mode; inactive does not mean zero provider requests.

### 2. Apply the reviewed additive migration and deploy the writer

Backend migration candidate is
`supabase/migrations/20261102193000_job_experimental_source_contracts.sql`.
It supports the larger reviewed contract set; only the initial two boards gain
runtime authorization. Preserve the current migrations and source-ID constraints.
Because the hosted historical version numbers differ from local filenames, use
**only the exact reviewed SQL file**, via the connected Supabase `apply_migration`
operation after approval. Its currently audited SHA-256 is:

```text
9ecab3145f99de5b2604de59b2fc4863f50ddf72ff169f9c8802ebdf8a4d8fe2
```

Future tool arguments are concrete:

| Argument | Approved value |
| --- | --- |
| `project_id` | `qhilcyvwvesqfuykdows` |
| `name` | `job_experimental_source_contracts` |
| `query` | Exact UTF-8 contents of backend `supabase/migrations/20261102193000_job_experimental_source_contracts.sql`, after confirming the hash above and final review. |

Re-read the migration head, absence of the new constraint and four definition
hashes immediately before this one mutation. If definitions or SQL bytes changed,
review the difference first. The tool records its own applied migration version;
save that acknowledgement and version rather than asserting the local filename
will become the hosted version. Verify the new constraint, supported-source
function and preserved execute ACLs afterward.

Do **not** run `supabase db push`, migration-history repair, `db reset`,
`--include-all`, seed dumps or role imports. Leave historical versions unchanged.
No migration tool or deployment has been executed by this proposal.

Build the exact reviewed backend commit through the existing project. After
confirming its Vercel project linkage and effective Preview secrets, one concrete
CLI deployment route is below. All variables are operator-supplied, verified
values; no placeholder is a guessed environment value. `ROLLOUT_BOARDS` is the
preserved current allowlist plus only the initial pair.

```sh
: "${ROLLOUT_BACKEND_DIR:?Set clean reviewed backend checkout}"
: "${ROLLOUT_BOARDS:?Set reviewed full comma-separated board allowlist}"
vercel deploy "$ROLLOUT_BACKEND_DIR" --target preview \
  --project prj_8IuYGMTJAxHUrhafvIfApYDX1Lor \
  --scope abhinaya-veerapaneni-s-projects \
  --env JOBS_COLLECTOR_BOARDS="$ROLLOUT_BOARDS" --yes
```

Do not use `--prod`, `--public`, or create a new linked project. If the established
writer uses Git branch-specific Preview environment settings, preserve that scope
before selecting this CLI route; otherwise use its existing deployment pipeline.
The TEST branch mapping is verified above, but the endpoint-secret binding and
TEST allowlist remain unresolved. Do not use the feature branch's generic
`ashby:openai` value as a replacement for the full writer scope.
The existing shared database URL/token/enable settings must survive unchanged.
Record the resulting deployment URL and exact SHA; verify readiness before
updating the shared collector endpoint. An environment override belongs to that
deployment, not a persistent change to future project deployments: carry this
reviewed allowlist into the writer's established branch-specific configuration
once that scope is identified.

### 3. Seed only proven empty new-board histories

Use an authenticated admin/service-role SQL session, not a public client or the
collector HTTP API. First inspect current catalog rows, tombstones, identities,
aliases, seeds and boards for each proposed scope. Confirm retained historical
ledgers contain no earlier jobs for these newly supported sources. Any existing
history requires reviewed identity import preserving first-seen dates and aliases;
do not run this empty-history recipe against it.

The exact existing RPC is
`job_collector_seed_identities(source, tenant, seed_id, operation, payload)`.
The legacy SQLite import CLI is not a zero-board seed tool and has additional
reader-scope/history requirements. Do not alter reader scope to bypass them.

Save the following reviewed SQL and its seed IDs with the private rollout record.
Run once in a transaction after the history audit. It fails before committing if
any history/seed is found or any tombstone anywhere lacks identity provenance.
Do not delete tombstones to get past that guard.

```sql
begin;
do $$
declare
  target record;
  acknowledgement jsonb;
begin
  if exists (
    select 1 from public.job_catalog_tombstones
    where source is null or source_tenant is null or source_job_id is null
       or first_seen_at is null
  ) then raise exception 'Unmapped tombstone history: reconcile before seeding'; end if;

  for target in select * from (values
    ('spacejobs', 'b761a0c7-742d-49a2-97bc-380838ea1b80'::uuid),
    ('railsjobs', 'e3bac939-2437-4644-941a-818282de4a60'::uuid)
  ) as approved(source, seed_id)
  loop
    if exists (select 1 from public.job_catalog where source=target.source)
       or exists (select 1 from public.job_catalog_tombstones where source=target.source)
       or exists (select 1 from public.job_collector_identities where source=target.source)
       or exists (select 1 from public.job_collector_identity_aliases where source=target.source)
       or exists (select 1 from public.job_collector_identity_seeds where source=target.source)
       or exists (select 1 from public.job_collector_boards where source=target.source
                  and (identity_ready or seed_id is not null or active_run_id is not null
                       or snapshot_mode <> 'observation_only'))
    then raise exception 'Existing history or seed for %: inspect, do not reseed', target.source;
    end if;

    perform public.job_collector_seed_identities(target.source, 'public', target.seed_id, 'begin',
      '{"expected_count":0,"provenance":{"method":"reviewed-empty-history","proposal":"initial-source-activation-2026-11-02"}}'::jsonb);
    acknowledgement := public.job_collector_seed_identities(target.source, 'public', target.seed_id, 'finish',
      '{"expected_count":0,"batches_expected":0,"history_complete":true}'::jsonb);
    if acknowledgement->'complete' is distinct from 'true'::jsonb
       or acknowledgement->'seeded_count' is distinct from '0'::jsonb
    then raise exception 'Unexpected seed acknowledgement for %', target.source; end if;
  end loop;
end $$;
select source, tenant, identity_ready, snapshot_mode, seed_id
from public.job_collector_boards
where source in ('spacejobs','railsjobs') and tenant='public';
commit;
```

Both results must have `identity_ready=true` and `snapshot_mode='observation_only'`.
The RPC also refuses conflicting leases. Stop on a conflict; do not clear a live
lease or create another seed ID. This wrapper deliberately rejects reruns after
success; inspect the saved seed acknowledgements rather than reseeding. No
Get on Board seed is included.

### 4. Point the trusted runner at the reviewed writer and activate one source at a time

First preserve the existing endpoint securely and re-read current repository
variable values; the reusable workflow runs in environment `test`, which currently
has no variable overrides:

```sh
gh variable list --repo varveta/applysmooth-data-fetch
gh variable list --repo varveta/applysmooth-data-fetch --env test
```

The owner is a User, so organization inheritance is inapplicable. Save the
effective repository values without printing any secrets:

```sh
gh variable get JOBS_ACTIVE_SOURCES --repo varveta/applysmooth-data-fetch \
  --json value --jq .value > /tmp/initial-active-before.json
gh variable get JOBS_SOURCE_NOT_BEFORE --repo varveta/applysmooth-data-fetch \
  --json value --jq .value > /tmp/initial-not-before-before.json
```

Prepare `/tmp/initial-writer-endpoint.txt` containing only the reviewed Preview
URL with `/api/jobs-collector`. Preserve the previous URL outside Git.

```sh
gh secret set COLLECTOR_ENDPOINT --repo varveta/applysmooth-data-fetch --env test \
  < /tmp/initial-writer-endpoint.txt
```

Retain existing token and project protection-bypass secrets. Because this endpoint
serves the existing sources too, verify an existing board's read/auth path after
the switch and preserve its allowlist scope. Do not trigger an unbudgeted full
existing-source refetch merely to test the endpoint.

For SpaceJobs first, derive a reviewed union preserving the existing active list:

```sh
python3 - <<'PY'
import json
from pathlib import Path
p = Path('/tmp/initial-active-before.json')
active = json.loads(p.read_text())
assert isinstance(active, list) and all(isinstance(x, str) for x in active)
assert 'getonboard' not in active, 'Unexpected pre-existing Get on Board activation: inspect first'
next_active = list(dict.fromkeys([*active, 'spacejobs']))
Path('/tmp/initial-active-spacejobs.json').write_text(json.dumps(next_active) + '\n')
PY
gh variable set JOBS_ACTIVE_SOURCES --repo varveta/applysmooth-data-fetch \
  < /tmp/initial-active-spacejobs.json
gh workflow run jobs-spacejobs.yml --repo varveta/applysmooth-data-fetch --ref main -f mode=publish
```

This preserves the verified repository scope; the file contains the complete
union. Keep both new workflows disabled until each manual acceptance is reviewed. GitHub may
require enabling a workflow to dispatch it: enable only the current source,
dispatch away from its scheduled time, and disable immediately on a failure.
If a `JOBS_SOURCE_NOT_BEFORE` entry is still in the future, wait until that budget
permits collection; a successful cooldown report is not publication proof.

After SpaceJobs' write and visibility checks pass, append `railsjobs` to the
already-reviewed effective active array in the same way, set that full JSON value,
and dispatch:

```sh
gh workflow run jobs-railsjobs.yml --repo varveta/applysmooth-data-fetch --ref main -f mode=publish
```

Do not activate `getonboard`. Source IDs in code or a successful dry-run never
substitute for the backend board allowlist, identity seed and runtime activation.

### 5. Prove actual writes, public presentation and scheduled execution

For each manual run, require `source-<source>-<run_id>` artifact mode `publish`,
`success=true`, the expected `public` board, fetch/gate counts, acknowledged batch
outcomes and completed run ID. A green dry-run/cooldown or accepted input count
alone is insufficient. Compare actual new/updated/unchanged row outcomes and
acknowledgements, not just the number scraped. Sample original descriptions/dates
privately; publish only count-level evidence.

Read-only SQL against the existing database provides corroboration:

```sql
select run_id, source, source_tenant, fetch_status, fetch_count, accepted_count,
       publish_status, batches_expected, batches_accepted, guard,
       missing_count, withdrawn_count, uncertain_count, completed_at
from public.job_collector_runs
where source in ('spacejobs','railsjobs') and source_tenant='public'
order by started_at desc limit 20;

select source, source_tenant, status, count(*) as rows,
       count(posted_at) as rows_with_original_dates,
       min(last_seen_at) as earliest_seen, max(last_seen_at) as latest_seen
from public.job_catalog
where source in ('spacejobs','railsjobs') and source_tenant='public'
group by source, source_tenant, status;
```

Expected observation completion guard is `partial_snapshot`, with no missing-job
withdrawals. Verify batch acknowledgements and retries are idempotent using the
retained isolated acceptance proof and real ledger records; do not manufacture
extra production publishes merely to repeat a test. Use sampled catalog IDs in
the existing search RPC/UI, for example:

```sql
select public.job_catalog_search('{"ids":["REPLACE_WITH_ACTUAL_CATALOG_ID"]}'::jsonb, 'member', false);
```

Check actual deployed cards and full descriptions show the required provider name
and followed provider backlink, and Apply keeps the exact provider URL (including
SpaceJobs tracking query). Verify member visibility and normal guest age rules;
do not backdate production rows to make guest tests pass. Check existing sources
still work through the shared writer after the endpoint change.

Only then enable each source's normal schedule and observe an actual `schedule`
event on `main` at the approved collector SHA:

```sh
gh workflow enable jobs-spacejobs.yml --repo varveta/applysmooth-data-fetch
gh workflow enable jobs-railsjobs.yml --repo varveta/applysmooth-data-fetch
gh run list --repo varveta/applysmooth-data-fetch --workflow jobs-spacejobs.yml \
  --event schedule --branch main --json databaseId,headSha,event,status,conclusion,createdAt,url
gh run list --repo varveta/applysmooth-data-fetch --workflow jobs-railsjobs.yml \
  --event schedule --branch main --json databaseId,headSha,event,status,conclusion,createdAt,url
```

Require successful **publish** artifacts and matching completed database runs for
those schedule events, plus a subsequent verification/lifecycle run without
unexplained closure or source-access failures. Observe a second daily cycle for
continuity before claiming reliability. Increment the live-source count only for
sources with actual accepted writes, visible listings and scheduled proof.

## Rollback

1. Disable only the affected new workflow(s), preserving all existing schedules:

   ```sh
   gh workflow disable jobs-spacejobs.yml --repo varveta/applysmooth-data-fetch
   gh workflow disable jobs-railsjobs.yml --repo varveta/applysmooth-data-fetch
   ```

2. Review in-flight runs. Let an already acknowledged transaction finish unless an
   active data issue requires stopping it; do not clear leases or delete partial
   run history. Remove only the affected new IDs from the **current** effective
   `JOBS_ACTIVE_SOURCES` array, preserving unrelated concurrent changes. Removing
   an active ID alone turns `auto` into dry-run and still fetches; workflow disable
   is necessary to stop scheduled provider requests. A future source not-before
   value also suppresses collection, but it does not constrain the verifier.
3. Remove the affected `source:public` scope from the writer's complete allowlist
   and deploy/repoint the protected Preview writer using the established mapping.
   This also removes that source from verification/lifecycle authorization. For
   whole-release rollback, restore the previously verified endpoint secret from
   its secure saved value after checking it still serves existing sources. Do not
   switch the global collector off when only a new source is affected.
4. Vercel deployment environments are immutable. Updating a branch variable does
   not revoke an older deployment's allowlist. Retire the newly activated writer
   deployment if necessary after the stable endpoint is restored; include its
   exact URL in the approved rollback record. Do not delete the prior healthy
   deployment or rotate shared credentials blindly.
5. Preserve catalog rows, supported SQL source IDs, identity seeds/aliases,
   original dates, tombstones and audit history. Do not down-migrate constraints
   while rows exist. Publication/access problems may require a separately scoped
   hiding action; a pipeline pause alone does not remove existing listings.
6. Confirm no new affected-source run completes after the pause except identified
   in-flight work; check existing source schedules continue successfully.

## Conditional Get on Board follow-on

[conditional-getonboard-activation.patch](conditional-getonboard-activation.patch)
is a separate diff **on top of** the initial pair. It adds Get on Board to the
collector-only approved-feed registry, its exact public target and a `06:32 UTC`
daily workflow. It is not part of initial approval or execution.

Before considering that patch: resolve supported hosted access, obtain fresh
passing source/link and isolated acceptance evidence without bypassing HTTP 403,
then repeat the same review with exact release pins, `getonboard:public` allowlist,
audited identity seed, runtime activation, rate budget and real scheduled proof.
No commands in this initial procedure seed or activate it.
