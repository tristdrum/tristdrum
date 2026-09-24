# Airbnb Cleaner

This is the protected personal deployment of the confirmed-only cleaner report.
It was imported from `tristdrum/min.cool` at source commit
`8626bf7afeda02f66c7e92231ff4bb0c2084fc56`, where all 45 cleaner tests passed.

The personal deployment preserves the existing parser, renderer, Gmail adapter,
retry behavior, and WhatsApp verification. Supabase `airbnb.cleaner_plans` is the
delivery-ledger authority; the volume JSONL remains a rollback mirror until the
post-cutover rollback window closes. Live delivery fails closed when the shared
ledger cannot be loaded.

An Airbnb alteration notice without complete current itinerary details cannot
advance a confirmed booking. The report fails closed until newer, verified
reservation evidence supplies the current dates and guest count. A stored row at
the notice's timestamp is not proof that the alteration was reconciled. Preserve
the original notice and link the later verified evidence to the same booking.

Adjacent confirmed bookings in the same studio form a continuing stay only when
the verified Airbnb reservation snapshots carry the same nonempty guest profile
ID. A shared name without that identity is not enough to suppress turnover work.

Scheduled attempts reuse a content-occurrence WhatsApp idempotency key, so
retries remain stable while a later `B -> C -> B` reversion gets a new key. Final
failure alerts are sent only to the private destination and count as delivered
only after exact chat readback. Live failures are mirrored into sanitized
Supabase job receipts even when plan generation does not complete.

The independent monitor checks the latest live run and matching shared delivery
ledger first. A current-window sent/duplicate-skipped receipt must have clean
confidence, synced database state, verified WhatsApp readback and matching plan
identity/hash before it can suppress an alert. A later blocked, failed or still
running check takes precedence over an earlier success. The monitor does not
depend on waking the Fly machine to reconfirm an already verified delivery.
When evidence is unavailable it reports that verification is needed, not that
the plan is definitely missing. Monitoring must never resend a plan to verify it.

Accepted early check-ins, late check-outs, and bag drops are read from the shared
Airbnb database and shown under the relevant unit in English and Xhosa. Office
storage appears on its actual arrangement date; an unspecified drop-off time
stays null and is described as unspecified in the bilingual note. A timing-note
read failure is recorded in the run receipt but does not suppress the underlying
confirmed-reservation cleaner plan.

Room plans do not assign workers or extend temporary cover. Agents monitoring
the group must follow the [cleaning-team authority](../../docs/AIRBNB_CLEANING_TEAM_AUTHORITY.md)
rules before responding to attendance or shift questions. This also applies to
ad hoc messages sent outside the scheduled report worker.

## Deployment Context

The cleaner Dockerfile is app-local: its build context must be
`apps/airbnb-cleaner`, not the repository root. After the scoped Fly identity and
app-status checks, deploy from that directory on the configured Mac:

```sh
/Users/tristdrum/.local/bin/fly-personal deploy --app tristdrum-airbnb-cleaner --remote-only --ha=false --yes
```

Check that no cleaner run or delivery is in flight before replacing its machine.
Keep the persistent data volume and shared delivery ledger intact. A successful
deployment does not authorize a duplicate plan; verify with status and a
non-sending preview when needed.
