# Airbnb Management Platform Rollout

Last updated: 2026-08-27 SAST.

## Current production state

- `tristdrum-airbnb-cleaner`, `tristdrum-airbnb-stock`, and
  `tristdrum-airbnb-support` exist in Tristan's personal Fly organization.
- The personal cleaner owns the eight active cleaner schedules. The eight old
  Min cleaner schedules are inactive, and the old Min app remains stopped as a
  rollback target.
- The four stock schedules are active. The support schedule is dormant and the
  service remains shadow-only with all external reply and alert writes disabled.
- The three local macOS cleaner LaunchAgents are disabled.
- `Airbnb Team` is the cleaning team destination. `Airbnb Management` contains
  only Tristan and Jane.
- Jane renamed the existing cleaning team chat to `Airbnb Team` on 27 August;
  its stable chat id did not change and no automation write was needed.
- The earlier automated group-subject rename did apply. WAHA/GOWS returned an
  empty successful response that Min incorrectly recorded as a terminal HTTP
  409. Do not replay that rename with another idempotency key.

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

The first 14:25 monitoring pass found that the Airbnb Team chat read took about 19
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
- Current support image: `deployment-01M10VSGA74SNNKMWN4R62VVBP`.
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
  or the adaptive agent requests host attention.
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

### Adaptive support agent rollout

The classifier and topic allowlist were removed on 26 August in PR #19, with a
focused lifecycle ownership hotfix in PR #20, bounded IMAP cleanup repair in
PR #22, initial-inquiry ingestion repair in PR #24, and IMAP error-event guard
in PR #26. Production source is merge commit
`6e22ff4729e8e45a40d87a266c51365e164986c2`.

- One `gpt-5.6-sol` Responses API decision at `xhigh` reasoning now receives the
  recent conversation, stay phase, listing and guest identity, verified property
  facts, hosting knowledge, and active timing request. Its output is limited to
  reply need, send/hold, Management attention, summary, and natural draft.
- The code-level invariants are the final Tristan/Jane human-reply race check,
  stable idempotency and Sent reconciliation, verified destinations, and exact
  cleaner timing side effects. There is no topic classifier or reply allowlist.
- Exact Monde and Zisanda regressions prove completed-stay tense, natural guest
  names, and warm emoji matching. Additional replay covers the before-booking
  arrival incident, complaints, booking changes, early-check-in creation and
  withdrawal, late-checkout refusal, readiness confirmation, and prompt injection.
- The first production shadow run failed closed with zero external writes and
  exposed that booking-expiry evidence and its audit actor did not satisfy the
  support worker RLS policies. PR #20 aligned both records with their existing
  support ownership and added a real support-role integration replay.
- The accepted shadow run `68795b8f-fb7a-409a-b9d1-ad2e2ee0f892` processed 27
  canonical emails, resolved one booking lifecycle event, produced one Sol/xhigh
  decision, and had zero decision failures, replies, Management sends, timing
  writes, or ambiguous deliveries.
- The first ordinary live poll `26210a40-9b1c-4753-b244-4546d7044cb0` succeeded
  with one provider-confirmed reply, zero ambiguity, and zero decision failures.
  Sent Mail contains the exact address/airport-transfer follow-up with no AI
  footer. Existing verified Management alerts prevented duplicate notifications.
- A later IMAP import deadline closed an already-disconnected ImapFlow client;
  its synchronous `Connection not available` exception escaped the timer callback,
  terminated the worker, and left run `60aab190-639a-431c-bcb0-c0e2188901bd`
  started. The heartbeat paused support immediately and recorded the run as an
  explicit `PROCESS_CRASH_IMAP_DEADLINE_CLEANUP` error.
- PR #22 made socket close idempotent, bounded logout cleanup, added outer
  Sent-mail guard deadlines, and proved deadline failures remain retry-safe before
  SMTP. Accepted shadow run `bc37a0bd-ea2a-4919-90fd-cfd262aabdef` and live run
  `fea00522-5b16-494c-886f-e377463c1745` then succeeded. The live run sent one
  provider-confirmed Bright late-arrival acknowledgement with no footer,
  ambiguity, or decision failure.
- PR #24 added trusted `automated@airbnb.com` initial inquiries to the canonical
  support stream. A notice without an SMTP route can now produce an intelligent
  draft and verified Management alert but never a guest email. Its later
  `express@airbnb.com` copy converges into the same message and delivery, retains
  the final human-reply guard, and retires only the obsolete route alert after a
  confirmed send. A genuine host-action alert survives a simultaneous reply.
- Production shadow run `a29c62c3-4b6b-40bd-a7e2-9c1d93774998` ingested 34
  canonical emails and produced three Sol/xhigh decisions with zero failures and
  zero external writes. Live runs `bbc5b2ef-26f9-435d-a6a0-966320285be4` and
  `bb1daaf1-bae7-41a4-afa6-c62ed3e6459a` then sent and read back exactly two
  Management alerts for the previously missed Prinsloo long-stay inquiries;
  no guest reply was attempted because Airbnb had not supplied a reply route.
- A later ImapFlow `NoConnection` event escaped the promise/deadline path and
  terminated the worker at 07:05 SAST on 27 August. PR #26 attaches an error
  observer before every IMAP connection, routes the event through the existing
  fail-closed rejection path, and retains the listener for late socket events.
  The release gate passed 74 pgTAP assertions and 271 application tests,
  including 101 support tests and the exact emitted-error regression.
- Accepted shadow run `777f543b-a8a4-432e-907a-5eedc6f72496`, controlled live
  run `3b5b5058-0c51-4a26-9d92-fca2f529a261`, and ordinary scheduled runs
  `20a21651-c35e-42ac-b510-9127cd9c1655` and
  `5581331a-df97-41f7-a439-cdf5931c5481` all completed without an IMAP crash,
  model failure, ambiguous send, or missing readback.
- One stock Management run observed a transient WhatsApp HTTP 404 and sent
  nothing. The writer was paused; both groups then returned HTTP 200 and two
  observation runs loaded 103 messages with no read error, after which the writer
  was restored. Order placement remained disabled throughout.
- The final release gate passed 74 pgTAP assertions and 270 application tests,
  including 100 support tests against the real local RLS role, plus web lint and
  production build. Independent review ended with no unresolved findings.

### Accepted guest-count reconciliation

The 27 August noon cleaner reconciliation found Alice Moyo's original Unit 1
confirmation for one adult but missed her later accepted change to two adults.
The accepted-change notice did not include the changed count, while the explicit
two-adult metadata appeared in a later message in the same Airbnb thread outside
the ordinary 80-envelope read window.

- PRs #28-#30 and follow-up commit `ce48f69` add bounded, fail-closed context
  recovery for accepted guest-count changes. A count is promoted only when the
  confirmation, discussion, accepted-change notice, and follow-up all match the
  exact Airbnb thread, guest, unit, and stay within narrow time bounds.
- Gmail-compatible listing search recovers the thread without relying on encoded
  thread ids in a `BODY` query. Recovery is limited to current-horizon
  confirmations, four accepted notices, and 24 fetched context messages.
- The historical replay corpus now includes the accepted guest-count incident,
  with negative coverage for wrong threads, lookalike senders, same-date
  replacements, generic update wording, and budget exhaustion.
- The release gate passed 74 pgTAP assertions and 280 application tests, plus web
  lint, production build, and independent review with no remaining findings.
- Deployed cleaner image: `deployment-01M11FVYJKZ40HAJQC6TWGAK4G`.
- Preview `2773a761-b547-4ad9-ba64-75a190a93cdf` and dry-run
  `58178808-1695-43c6-98a8-473d740f1b31` both produced clean confidence with
  Unit 1 Alice Moyo at two guests, Unit 2 Xolisa Jezile at one guest, and Unit 3
  Stephanie Tilley as a stayover. Dry-run remained non-mutating and appended no
  ledger row.
- Controlled live run `b5bb5ab2-03bc-4297-b070-4c5bac98b67b` sent and read back
  the reviewed plan once. The restored 13:50 final retry
  `10e810a9-9b81-490d-a85f-a4f84e27319e` then sent one legitimate update because
  the weather forecast changed from 8% at 3 p.m.-midnight to 17% at noon-midnight;
  all booking lines remained identical.
- Supabase stores Alice as a confirmed two-adult revision with the accepted
  change provenance, both cleaner rows have clean confidence and verified Min
  API readback, and all eight cleaner jobs are active again.

### Support alert and Fly lifecycle repair

The 27 August heartbeat contained one transient Gmail import timeout, then found
two independent support reliability issues while verifying the retry path.

- Run `9ab0b776-1e2b-438a-9e14-038ee93b0631` failed closed with
  `IMAP_IMPORT_DEADLINE`. Both Tristan and Jane IMAP/SMTP doctors passed, and
  write-disabled shadow run `e2891547-352e-46e9-9140-4f0352ffc4ee` succeeded.
- The controlled live retry exposed two old Prinsloo immediate-stage alerts that
  could surface after their higher overdue/reminder stages had already been
  delivered during the shadow-to-live transition. No guest email was sent.
- PRs #32 and #33 permanently retire lower sibling stages after a verified
  Management alert and preserve that retired marker through an intervening
  shadow pass. The real support-role integration test reproduces the exact
  shadow-between-live sequence.
- One-time production reconciliation retired the only remaining stale sibling.
  Final shadow run `704e54b5-22c5-40e5-aab1-895d4c79ed2d` and controlled live run
  `7e877421-d04c-4739-8e0e-c8c40434a618` then completed with zero replies, alerts,
  model failures, or ambiguous deliveries.
- The first restored ordinary poll was interrupted when Fly autostopped the
  support machine four seconds into its request. The stranded receipt was closed
  explicitly as `PROCESS_INTERRUPTED_FLY_AUTOSTOP`.
- PR #34 keeps one support machine warm for the five-minute watcher while leaving
  cleaner and stock scaling unchanged. Final support image:
  `deployment-01M11M6Y60TCCKQANTN7WB7BQS`.
- Ordinary scheduled run `ac07fbab-10b2-4a1b-b1aa-2a0eab3f0a26` completed at
  15:02:01 SAST with zero replies, alerts, classification/decision failures, or
  ambiguity. The machine remained started and healthy, and all 102 support tests
  passed against the local RLS integration database.

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

- Heartbeat `airbnb-cleaner-midday-cutover-check` performs hourly daytime personal
  platform and exact outbound-message audits at 25 minutes past each hour from
  07:25 through 21:25 SAST.
- The latest support repair reset the clean-run clock at the final ordinary
  scheduled acceptance on 2026-08-27 15:02:01 SAST. Require 72 clean hours before
  treating the replacement as stable; the new stability checkpoint is
  2026-08-30 15:02:01 SAST.
- Do not delete the stopped Min app or rollback data before the seven-day gate.
  The earliest retirement checkpoint is 2026-09-03 15:02:01 SAST, after seven
  full clean days from the latest repairs. Extend the heartbeat if verification
  delays retirement.
- Delete old infrastructure only after schedules, receipts, WhatsApp readback,
  current Gmail reservation evidence, stock observations, and dashboard state
  all remain clean.
