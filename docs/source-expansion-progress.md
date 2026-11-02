# Goal: 50 distinct live production sources

Current baseline: 12. Additional live sources: 0. Remaining production gap: 38.
The full candidate queue is `source-expansion-tracker.json`; entries are not implementations.
Preserve this goal until 50 sources have proven scheduled writes and display eligibility.

## November 2 checkpoint

- Pinpoint and Breezy: existing TEST branch adapters, 58 accepted / 85 fetched in
  [cloud run 41467198234](https://github.com/varveta/applysmooth-data-fetch/actions/runs/41467198234), zero writes.
- Manatal: new experimental adapter, 2 real employer listings fetched, 1 accepted,
  1 quarantined for unknown US eligibility, zero writes. Count-only local evidence:
  `evidence/2026-11-02-manatal-local.json`. Both dates are unknown, so acceptance is
  NOT proof of freshness or readiness. No demo or goCloudOffice procurement RFQs
  included. More employers and freshness evidence needed before rollout.
- Manatal uses the [documented public career API](https://developers.manatal.com/reference/career-page_jobs_list).
  Employer pages: https://www.careers-page.com/primary-care-collaborative and
  https://www.careers-page.com/trolley-2. Public reads establish technical access,
  not unrestricted commercial republication permission.
- Bound pagination to the same tenant API path, 100 pages / 10,000 records, with
  duplicate/count-change/partial-response failure. Full descriptions preserved.
  Missing dates stay null. Presence-only observation policy; production publication
  is blocked by the common experimental-source guard.
- TEST matrix automatically discovers Manatal from `expansion-test.json`.
- Backend worktree: `~/.codex/worktrees/50-source-expansion/backend`, branch
  `feat/experimental-source-contracts`, based on PROD c854c05d. Initial Pinpoint/Breezy
  HTTP contract support and exact employer-host attribution checks prepared locally.
  No database migration, deployment, activation or shared database writes performed.

## Next work (do not treat this checkpoint as completion)

1. Verify the new TEST run and keep count-only evidence in the tracker.
2. Complete Pinpoint/Breezy SQL source support, board validation and observation-only
   policy in an additive migration. Test insertion, idempotent replay, failed batches,
   explicit expiry and missing-job handling against isolated local PostgreSQL.
   Docker was not running at the initial check. Never use shared production Supabase.
3. Implement verification for experimental feeds; currently they return uncertain.
4. Pass real collector rows through backend HTTP/SQL validation and isolated preview
   acceptance before presenting a production rollout for approval.
5. Add additional real Manatal employers; investigate original publication dates.
6. Continue Trakstar/TalentLyft employer discovery and other candidates beyond the
   existing list. Provisioned candidates remain candidates until access is available.
7. Prepare exact backend/collector commits, migrations, boards, schedules, terms,
   rollback and verification steps for approval. No production rollout is authorized
   by TEST success alone.

Cross-source unique yield is unmeasured; empty-identity accepted counts must not be
reported as net new catalog inventory. No provider contacted, key registered, or
service purchased during this checkpoint.
