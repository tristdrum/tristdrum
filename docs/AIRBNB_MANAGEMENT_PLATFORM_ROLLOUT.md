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

- content-scoped cleaner delivery idempotency and exact failure-alert chat
  readback;
- durable failed cleaner run receipts in Supabase;
- read-only WhatsApp stock observations that can request a physical count but
  cannot move inventory;
- stale-count confirmation, hand-soap and towel-set tracking, and honest
  R350/R400 shopping-list minimum handling when prices are unknown;
- deterministic verified support templates and explicit high-risk phrase
  blocking;
- delayed-alert stage selection with exact Management readback;
- absolute stock counts, list-order confirmation, bounded conversation context,
  and recursive secret-field redaction in the private dashboard;
- a 09:05 Tuesday full review so it cannot collide with the 09:00 stock poll.

Local release evidence on 2026-08-24:

- 66 Supabase SQL assertions passed after a clean local database reset.
- 188 cleaner, core, stock, support, and dashboard tests passed.
- Dashboard lint and production build passed.
- `git diff --check` passed.

The pending production migration is
`20260823215943_airbnb_operational_hardening.sql`.

## Open gates

- The personal Fly helper must pass `auth whoami` and read-only status for all
  three apps before deployment. Its Keychain credential was unavailable during
  the 2026-08-24 preflight, so no deploy was attempted.
- The linked Supabase CLI must authenticate and show only the expected pending
  migration before `db push` is allowed.
- OpenAI classification currently returns `insufficient_quota`. Support must
  stay shadow-only and unscheduled until classification succeeds and both
  Tristan and Jane host-reply round trips are proven from the canonical stream.
- No order placement is permitted. WhatsApp stock evidence remains read-only,
  and cleaner verification must not create a second plan.

## Production verification

After the migration and app deploys:

1. Confirm all eight personal cleaner jobs are active and all eight old Min jobs
   remain inactive.
2. Confirm the four stock jobs are active, including the Tuesday 09:05 review,
   and the support job remains inactive.
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
  The conservative retirement checkpoint is 2026-08-30 after the 14:25 audit.
- Delete old infrastructure only after schedules, receipts, WhatsApp readback,
  current Gmail reservation evidence, stock observations, and dashboard state
  all remain clean.

