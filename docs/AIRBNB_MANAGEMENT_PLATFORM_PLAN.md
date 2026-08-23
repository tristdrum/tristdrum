# Personal Airbnb Management Platform

Status: Approved for implementation on 2026-08-21.

## Safety invariant

The existing cleaner report is the protected production path. Do not disable,
replace, or delete its Fly app, schedules, state, or credentials until the
personal replacement has passed side-by-side previews, dry runs, live chat
verification, duplicate checks, independent monitoring, and a rollback window.

## Summary

- Consolidate Airbnb operations in this personal repository and the existing
  personal Supabase project.
- Run three isolated personal Fly apps:
  `tristdrum-airbnb-cleaner`, `tristdrum-airbnb-stock`, and
  `tristdrum-airbnb-support`.
- Keep Min.cool only as the scoped WhatsApp transport.
- Add a private `/dashboard/airbnb` area for reservations, cleaning, guest
  conversations, stock, orders, alerts, and job health.

## Shared foundation

- Add a shared `packages/airbnb-core` package for email parsing, reservation
  reconciliation, property facts, inventory calculations, redaction, and
  provider clients.
- Create a private Supabase `airbnb` schema for properties, reservations,
  evidence, guest threads, messages, reply deliveries, cleaner plans,
  inventory movements, orders, alerts, job runs, and audit events.
- Keep the schema outside the browser-facing Data API. Expose only
  household-authorized public RPCs required by the dashboard; workers use a
  scoped database role.
- Retain normalized guest messages indefinitely in the private schema. Never
  commit raw mailbox contents or guest details to Git.
- Deduplicate every email, WhatsApp write, cleaner plan, order event, and guest
  reply using provider identifiers and deterministic hashes.
- Use Tristan's Gmail as the canonical Airbnb conversation stream. Use Jane's
  Gmail as supplemental booking evidence and the authoritative Sixty60 order
  source.
- Store Gmail, Supabase, OpenAI, Fly scheduler, and Min customer API credentials
  only as scoped Fly secrets.

## Cleaner service

- Move the proven confirmed-only cleaner implementation and historical fixtures
  from Min.cool without changing formatting, weather fallback, reconciliation,
  idempotency, or WhatsApp verification behavior.
- Replace Fly-volume JSONL state with Supabase ledger and sanitized run-receipt
  tables after importing the existing ledger history.
- Preserve the SAST schedule: today at 12:00, 12:10, and 12:20; tomorrow at
  13:30, 13:40, and 13:50; independent monitors at 12:50 and 14:20.
- Rename the active `Airbnbs` group to `Airbnb Maids`, leave the old
  `Bowie airbnbs` group untouched, and create `Airbnb Management` containing
  Tristan and Jane.
- Send cleaner plans only to `Airbnb Maids`. Send failures, blocked confidence
  checks, stock alerts, and guest escalations only to `Airbnb Management` or
  Tristan privately.

## Stock and orders

- Infer stock from verified 1 Bowie Sixty60 purchases, confirmed guest
  consumption, manual adjustments, and relevant Jane or maid messages.
- Run a full review every Tuesday at 09:05 SAST and a silent daily depletion
  forecast at 09:00, so the two jobs cannot contend for the stock worker lock.
- Poll Jane's Sixty60 emails every 30 minutes from 07:00 to 21:00 SAST.
- Forecast seven days of confirmed demand plus a 25 percent buffer. Trigger a
  shopping list when an item is projected to run out within three days.
- Use one chocolate and one 500 ml water per guest, one 250 ml milk per occupied
  studio stay, one wrapped rusk and one coffee portion per guest, and two sugar
  portions per guest.
- Track cleaning products, toilet rolls, refuse bags, bleach, multipurpose
  cleaner, dishwashing liquid, laundry detergent, bath mats, mugs, glasses, and
  linen readiness.
- Mark inferred or stale quantities as counts to confirm. Do not ask the maids
  for routine stock counts in the initial release.
- Build suggested orders to at least R350, targeting roughly R400 by adding
  useful nonperishable buffer stock. Never place an order automatically.
- Post a provisional Management alert when an order confirmation arrives because
  that email lacks the address. Credit inventory only when the invoice confirms
  1 Bowie; silently ignore invoices for other addresses.

## Guest support

- Poll Tristan's Airbnb conversation mail every five minutes and use Jane's
  inbox only as supplemental evidence.
- Backfill historical conversations into the private schema and curate
  anonymized fixtures for greetings, Wi-Fi, directions, check-in, unanswered
  requests, booking questions, complaints, exceptions, and previous mistakes.
- Automatically answer only verified low-risk topics: Wi-Fi, standard address,
  directions, parking, confirmed amenities, standard check-in and check-out
  times, greetings, thanks, and resending approved information.
- Never automatically accept or decline bookings, promise availability, discuss
  refunds or discounts, change dates, handle complaints or safety issues, grant
  exceptions, or answer from uncertain property facts.
- Alert Management immediately for non-whitelisted or uncertain messages,
  remind after 45 minutes, and mark the case overdue after 60 minutes.
- Generate classifications and drafts through the OpenAI Responses API using
  `gpt-5.6-terra`, `store: false`, low reasoning, no external tools, and strict
  JSON-schema output.
- Send autonomous replies from Tristan's Gmail as a threaded reply ending with
  `Automated reply on behalf of your hosts.`
- Immediately before sending, lock the thread, re-fetch its latest email events,
  and compare them with the draft's source fingerprint.
- Cancel and re-evaluate if a newer guest event exists. Mark handled without
  sending if any newer host event exists, regardless of whether Airbnb labels
  the host as Jane.
- Generate a stable outbound Message-ID and reconcile Gmail Sent before retrying
  an ambiguous SMTP failure.

## Dashboard

- Add an authenticated Airbnb section to the existing private dashboard with
  Overview, Guests, Cleaning, Stock and Orders, and System views.
- Show source evidence, confidence, status, and timestamps without exposing
  secrets or raw email headers.
- Allow authorized household users to approve or edit escalated replies, record
  stock corrections, confirm order placement, and inspect job receipts.

## Validation and rollout

### Fly account routing

- Run every command for `tristdrum-airbnb-cleaner`,
  `tristdrum-airbnb-stock`, and `tristdrum-airbnb-support` through
  `/Users/tristdrum/.local/bin/fly-personal`.
- Never use bare `fly` or `flyctl` for this platform. The shared login may belong
  to another concurrent Codex task, while the scoped helper remains bound to
  Tristan's personal Fly organization.
- Verify the helper with `fly-personal auth whoami` and
  `fly-personal status --app <app>` before a production mutation. Never print,
  export, inspect, or copy the underlying Keychain token.

- Keep all existing cleaner tests green and replay the confirmed-only historical
  corpus against the migrated implementation.
- Add regression coverage for Jane's `automated@airbnb.com` notifications versus
  Tristan's `express@airbnb.com` conversation stream, including host replies
  labelled `JANE / Host` even when Tristan sent them.
- Prove that replies sent separately by Tristan and Jane both appear in the
  canonical stream before autonomous sending is enabled.
- Test the final-send race: a human reply, new guest message, duplicate scheduler
  run, or ambiguous SMTP result must never produce a second reply.
- Test inventory consumption, buffers, R350/R400 ordering, provisional address
  handling, non-Bowie exclusion, duplicate invoices, and uncertain counts.
- Deploy all three apps with schedules and external writes disabled. Import
  state, run historical replay, preview current reservations, and compare the
  new cleaner against production.
- Cut over the cleaner first by pausing the old eight jobs, enabling the new
  jobs, verifying the exact WhatsApp plan and monitor receipt, and retaining the
  old app stopped for rollback.
- Run stock ingestion in observation mode before enabling Management alerts.
- Run guest support in shadow mode, complete the Tristan and Jane round-trip
  test, and dry-run every whitelist case before enabling low-risk replies.
- Monitor all services for 72 hours. Retain the stopped old Fly app for seven
  days, then remove it only after schedules, receipts, WhatsApp evidence, and
  database state remain clean.

## Acceptance criteria

- The cleaner never misses a due plan, sends at most one correction per changed
  plan, and fails closed on impossible reservation state.
- The production cleaners chat, latest ledger row, run receipt, and reservation
  evidence agree after every monitored window.
- No stock is credited from an addressless confirmation or a non-Bowie invoice.
- No autonomous guest reply can race or duplicate a human response.
- Every external action is attributable through a sanitized audit record.
- Old infrastructure is not deleted until the seven-day rollback period ends.
