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
- Expected operational-hardening migration SHA-256:
  `def319397044e22b28304e22c5cf0de187929edaeb91d47cb0aaae048a70bc4a`.
- Expected follow-up migration SHA-256:
  `3052bff38e55e881e980c79654f1c352fec233d64a6d64119c8cdf6732da54b7`.

## Read-only cutover preflight

Verified at 2026-08-24 07:26 SAST without changing production:

- The official personal Supabase CLI credential is owner-only (`0600`) and,
  with ambient `SUPABASE_ACCESS_TOKEN` removed, lists linked project
  `akvlarrmhlbnuvnfpvic` as `ACTIVE_HEALTHY`.
- `supabase migration list --linked` reports an exact two-migration pending
  suffix: `20260823215943_airbnb_operational_hardening.sql`, followed by
  `20260824012012_airbnb_release_safety_followup.sql`. All preceding local and
  remote versions match.
- `cron.job` contains eight active cleaner jobs, four active stock jobs, and the
  inactive `airbnb-support-shadow-poll-5m` job. Every scheduled job that has
  fired most recently reports `succeeded`; the weekly stock review has not yet
  reached its first trigger.
- `net.http_request_queue` contains no pending cleaner, stock, support, or other
  requests.
- The latest cleaner receipt for 24 August is `duplicate_skipped`, with clean
  confidence, successful WhatsApp dry-run, exact chat readback, and synced
  database state. The latest stock observation and Management runs succeeded,
  while order placement remained disabled. The most recent support run was
  shadow-only with zero replies and zero Management notifications.
- `/Users/tristdrum/.local/bin/fly-personal auth whoami` still fails closed with
  `personal Fly credential is unavailable in Keychain`. No Fly status, stop,
  deploy, Supabase pause, or migration command was attempted after that failure.

## Open gates

- The personal Fly and linked Supabase gates cleared on 2026-08-24. The guarded
  migration and deployment completed without a mixed-version window.
- The native Supabase connector did not expose the linked project
  `akvlarrmhlbnuvnfpvic` during the 2026-08-24 preflight. It is not an
  authorized substitute unless that exact project becomes visible and its
  account scope is verified.
- The replacement OpenAI key authenticates and completed a real
  `gpt-5.6-terra` Responses API request. Support shadow classification now
  succeeds, but support must stay unscheduled and unable to write until both
  Tristan and Jane host-reply round trips are proven and the verified property
  facts required by the autonomous allowlist are populated.
- No order placement is permitted. WhatsApp stock evidence remains read-only,
  and cleaner verification must not create a second plan.

## Hardening cutover

The reviewed hardening cutover completed at 2026-08-24 09:10 SAST.

- All thirteen Airbnb jobs were paused before migration. At quiescence, all
  three personal Fly machines were stopped, `net.http_request_queue` was empty,
  and no `airbnb.job_runs` row remained `started`.
- The exact reviewed migration suffix was applied in order, and linked history
  now matches through `20260824012012`.
- Deployed cleaner image: `deployment-01M0S9292YSCKWRRZBVMQBPNAX`.
- Deployed stock image: `deployment-01M0S93VSD35YQQFR88QX05W6C`.
- Deployed support image: `deployment-01M0S958GWZ4NNYQZS4MKCP4ZP`.
- Cleaner preview for 24 August returned HTTP 200, `status: preview`, and clean
  confidence. The subsequent dry-run returned `dry_run_ok`; the WhatsApp
  dry-run returned HTTP 200 with `mutatesWhatsappState: false`. The cleaner
  ledger retained its single existing 24 August content row and occurrence.
- Stock observation completed successfully with external writes disabled,
  zero Management alerts, and order placement disabled.
- Support shadow scanned 29 canonical emails, classified eight candidates with
  zero classification failures, and produced zero guest replies and zero
  Management notifications. Booking candidates remained high-risk and needed
  approval.
- Eight cleaner and four stock jobs were restored with their reviewed schedules.
  The support job remains inactive. Public health checks and
  `/dashboard/airbnb` returned HTTP 200 after deployment.

### Stock WhatsApp timeout repair

The first 14:25 monitoring pass found that the Maids chat read took about 19
seconds while the stock worker allowed only eight seconds. Email ingestion,
forecasting, and scheduling still succeeded, but WhatsApp stock evidence was
being skipped with a sanitized timeout receipt.

- Commit `2ee47df` raised only the bounded WhatsApp request timeout to 30
  seconds; ordering and support capabilities were unchanged.
- Stock and shared-core tests passed: 65 passed and one database integration
  test was skipped because no integration database was configured.
- Deployed stock image: `deployment-01M0SWDB849YRGFCRBKBXTZV21`.
- A manual observation and the ordinary 14:45 SAST Management run both
  completed successfully. Each loaded 85 WhatsApp messages with no read error,
  found no actionable stock observation, sent no Management alert, and retained
  `orderPlacementAllowed: false`.

### Support go-live and cleaner reconciliation repair

The support writer went live on 25 August and the monitored repair sequence
completed on 26 August.

- Migration history now matches through `20260825125026`. One live support job
  runs every five minutes; the shadow job is inactive. Eight cleaner and four
  stock jobs remain active.
- Current cleaner image: `deployment-01M0YT1D2KKCJNTGFSH2X26ZKW`.
- Current support image: `deployment-01M0YVPKYWH2RFGNE955VME08Y`.
- The Anele late-arrival incident is a regression: an arrival before the booked
  date receives an immediate grounded acknowledgement and Management alert,
  while the final Tristan/Jane Sent-mail check can still veto delivery.
- Automatic guest replies no longer contain an AI footer. The first two live
  sends were provider-confirmed thank-you replies with no ambiguity or newer
  human response. Monitoring then replaced their rigid pre-stay wording with
  context-aware model wording.
- Messages with `replyNeeded: false` now become terminal `cancelled` deliveries
  with reason `No reply needed`, mark the thread handled, and resolve stale
  alerts. Human-review alerts are created only when a reply is genuinely needed
  or the classifier explicitly marks the case urgent.
- Cleaner MIME selection now preserves confirmations under the ordinary read
  cap and recovers missing update anchors by confirmation code in a bounded
  400-day window. Supabase `date` values are normalized before ledger planning.
- The 25 August replay completed in 48 seconds with clean confidence and
  correctly classified Stephanie Tilley as a one-guest Unit 3 turnover.
- The recovered 26 August live run sent one verified `Updated Airbnb plan` for
  Bright Agu, one guest, synced 90 evidence rows and 41 reservations, and
  preserved Units 2 and 3 as stayovers. Exact cleaners-chat readback matched.
- A deployment-interrupted support run is retained as an explicit
  `DEPLOY_INTERRUPTED` error rather than deleted or presented as success.
- Stock remains observation/Management-only. Order placement is disabled and
  there are no order-placement audit events.

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
   review attempts, and exactly one support-live job is active.
3. Run cleaner preview and dry-run, then reconcile the latest receipt, ledger,
   confidence result, database sync, and exact cleaner-chat readback.
4. Run stock observation mode and confirm WhatsApp evidence contains no raw
   body, creates no inventory movement, places no order, and only flags matched
   items for counting.
5. Inspect each support-live receipt, Sent-mail reply, final human-reply guard,
   and Management readback. Require zero ambiguous deliveries and no alert for
   a message that needs no reply.
6. Verify `/dashboard/airbnb` serves the deployed build and exposes no
   credential-shaped fields.

## Monitoring and retirement

- Heartbeat `airbnb-cleaner-midday-cutover-check` performs the daily personal
  platform and rollback audit at 14:25 SAST.
- The latest cleaner and support repairs reset the clean-run clock at
  2026-08-26 12:50 SAST. Require 72 clean hours before treating the replacement
  as stable; the new stability checkpoint is 2026-08-29 12:50 SAST.
- Do not delete the stopped Min app or rollback data before the seven-day gate.
  The earliest retirement checkpoint is 2026-09-02 12:50 SAST, after seven full
  clean days from the latest repairs. Extend the heartbeat if verification
  delays retirement.
- Delete old infrastructure only after schedules, receipts, WhatsApp readback,
  current Gmail reservation evidence, stock observations, and dashboard state
  all remain clean.
