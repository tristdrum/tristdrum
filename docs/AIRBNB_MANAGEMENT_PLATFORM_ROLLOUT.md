# Airbnb Management Platform Rollout

Last updated: 2026-08-24 SAST.

## Current production state

- `tristdrum-airbnb-cleaner`, `tristdrum-airbnb-stock`, and
  `tristdrum-airbnb-support` exist in Tristan's personal Fly organization.
- The personal cleaner owns the eight active cleaner schedules. The eight old
  Min cleaner schedules are inactive, and the old Min app remains stopped as a
  rollback target.
- The four stock schedules are active. The support schedule is dormant and the
  service remains shadow-only with all external reply and alert writes disabled.
- The three local macOS cleaner LaunchAgents are disabled.
- `Airbnb Maids` is the cleaner destination. `Airbnb Management` contains only
  Tristan and Jane.
- The group-subject rename did apply. WAHA/GOWS returned an empty successful
  response that Min incorrectly recorded as a terminal HTTP 409. Do not replay
  that rename with another idempotency key.

## Candidate hardening release

The candidate release adds:

- content-occurrence cleaner delivery idempotency, including `B -> C -> B`
  reversions, and exact failure-alert chat readback;
- durable failed cleaner run receipts in Supabase;
- read-only WhatsApp stock observations that can request a physical count but
  cannot move inventory;
- authoritative physical-count snapshots, stale-count confirmation, hand-soap
  and manually counted towel-set tracking, strict 1 Bowie Street invoice
  credit, and an always-visible R350/R400 shopping reminder;
- deterministic verified support templates and explicit high-risk phrase
  blocking;
- delayed-alert stage selection with exact Management readback;
- absolute stock counts, list-order confirmation, bounded conversation context,
  and recursive secret-field redaction in the private dashboard;
- idempotent Tuesday 06:00 and 06:20 full-review attempts, plus Management runs
  halfway between the regular observation polls.

Local release evidence on 2026-08-24:

- 74 Supabase SQL assertions passed after a clean local database reset.
- 219 cleaner, core, database, stock, support, and dashboard tests passed.
- Dashboard lint and production build passed.
- `git diff --check` passed.

The reviewed production delta is
`20260824012012_airbnb_release_safety_followup.sql`. The preceding
`20260823215943_airbnb_operational_hardening.sql` remains byte-for-byte
unchanged from its published commit; linked migration status must determine
whether one or both are pending.

- Reviewed application source commit:
  `61770444fbc074bb2abc15a2a2059e8cc07933c1`.
- Expected follow-up migration SHA-256:
  `3052bff38e55e881e980c79654f1c352fec233d64a6d64119c8cdf6732da54b7`.

## Open gates

- The personal Fly helper must pass `auth whoami` and read-only status for all
  three apps before deployment. Its Keychain credential was unavailable during
  the 2026-08-24 preflight, so no deploy was attempted.
- The linked Supabase CLI must authenticate and show only the expected pending
  migration before `db push` is allowed.
- The native Supabase connector did not expose the linked project
  `akvlarrmhlbnuvnfpvic` during the 2026-08-24 preflight. It is not an
  authorized substitute unless that exact project becomes visible and its
  account scope is verified.
- OpenAI classification currently returns `insufficient_quota`. Support must
  stay shadow-only and unscheduled until classification succeeds and both
  Tristan and Jane host-reply round trips are proven from the canonical stream.
- No order placement is permitted. WhatsApp stock evidence remains read-only,
  and cleaner verification must not create a second plan.

## Production verification

Use this order so no scheduled request can cross a mixed schema/app version:

1. Verify the personal Supabase account and `/Users/tristdrum/.local/bin/fly-personal`
   account scope, then record the linked migration list, twelve active
   cleaner/stock job rows, support inactivity, and all three current Fly image
   identifiers. Accept only the expected pending suffix ending in
   `20260824012012_airbnb_release_safety_followup.sql`; never repair or replay an
   already-recorded migration.
2. Pause the eight cleaner jobs and four stock jobs with one linked Supabase
   query and keep support inactive. Stop the three personal Airbnb Fly machines,
   confirm they are stopped, confirm no relevant request remains queued in
   `net.http_request_queue`, and wait for any already-issued request to reach a
   terminal response before changing schema.
3. Apply exactly the expected pending migration suffix. If it fails or the job
   inventory differs, leave every personal worker stopped and use the retained
   old Min cleaner as the rollback path.
4. Deploy cleaner, stock, and support from the recorded source commit, which
   restarts the personal machines on the reviewed images. Keep all schedules
   inactive while checking health, preview, dry-run, database writes, and exact
   chat readback.
5. Re-enable the eight cleaner jobs only after cleaner acceptance passes.
   Re-enable the three read-only stock observation jobs after one clean
   observation receipt. Re-enable the stock Management job only after a
   controlled dry-run/live/readback check. Support remains inactive.

After that guarded cutover:

1. Confirm all eight personal cleaner jobs are active and all eight old Min jobs
   remain inactive.
2. Confirm the four stock jobs are active, including the Tuesday 06:00/06:20
   review attempts, and the support job remains inactive.
3. Run cleaner preview and dry-run, then reconcile the latest receipt, ledger,
   confidence result, database sync, and exact cleaner-chat readback.
4. Run stock observation mode and confirm WhatsApp evidence contains no raw
   body, creates no inventory movement, places no order, and only flags matched
   items for counting.
5. Run support shadow mode and confirm zero replies and zero Management alerts.
6. Verify `/dashboard/airbnb` serves the deployed build and exposes no
   credential-shaped fields.

## Monitoring and retirement

- Heartbeat `airbnb-cleaner-midday-cutover-check` performs the daily personal
  platform and rollback audit at 14:25 SAST.
- Require 72 clean hours after this hardening release before treating the
  replacement as stable.
- Do not delete the stopped Min app or rollback data before the seven-day gate.
  The retirement checkpoint is seven full days after the actual hardening
  cutover, never a preselected calendar date. Extend the heartbeat when the
  credential handoff delays cutover.
- Delete old infrastructure only after schedules, receipts, WhatsApp readback,
  current Gmail reservation evidence, stock observations, and dashboard state
  all remain clean.
