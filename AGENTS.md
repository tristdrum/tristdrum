# Agent Guidance

This is `tristdrum/tristdrum`, the combined personal website, private dashboard,
finance, and Airbnb application repository. Airbnb application code was
consolidated here; Min.cool supplies the scoped WhatsApp transport.

## Component Map

| Area | Entry point |
| --- | --- |
| Personal website and private dashboards, including `/dashboard/airbnb` | [web](web/README.md) |
| Confirmed-reservation cleaner plans and delivery | [airbnb-cleaner](apps/airbnb-cleaner/README.md) |
| Stock evidence, forecasts, and Management alerts | [airbnb-stock](apps/airbnb-stock/README.md) |
| Guest conversations and guarded replies | [airbnb-support](apps/airbnb-support/README.md) |
| Shared Airbnb parsing, domain logic, and providers | [airbnb-core](packages/airbnb-core/) |
| Shared worker database access | [airbnb-db](packages/airbnb-db/) |
| Finance evidence ingestion | [finance-ingest](packages/finance-ingest/README.md) |
| Database definitions, migrations, and tests | [supabase](supabase/) |

Read the relevant component README before changing its behavior. The
[Airbnb platform plan](docs/AIRBNB_MANAGEMENT_PLATFORM_PLAN.md) records design
intent; the [rollout record](docs/AIRBNB_MANAGEMENT_PLATFORM_ROLLOUT.md) contains
dated operational evidence. Verify current code and runtime state before
operational actions: historical receipts and default modes do not prove what
is deployed, enabled, or healthy now.

## Accounts and Operating Safeguards

- The three `tristdrum-airbnb-*` workers belong to the personal Fly account. On
  the configured Mac, use the account-scoped `fly-personal` helper and verify
  `auth whoami` and the target app's `status` before operations. Use the active
  profile's credential routing on other hosts; never borrow the Tech Local
  account or depend on a shared bare Fly login.
- Use the Min.cool customer WhatsApp API for transport. Keep its account scope
  separate from personal app ownership. Existing task authorization and live
  delivery gates apply; a code or documentation change does not authorize
  guest messages, WhatsApp sends, deployments, or schedule changes.
- Preserve cleaner confirmed-reservation checks, the shared delivery ledger,
  stable idempotency, and exact destination readback. Do not revive old Min
  schedules or duplicate the active personal delivery path.
- For support, Tristan's conversation mail is the reply route; Jane's mail is
  supplemental evidence. Preserve newer-host/guest vetoes, explicit live gates,
  and the prohibition on automatic retry after an ambiguous SMTP result.
- Stock observations do not place orders. Preserve verified-address invoice
  checks, authoritative physical counts, and guarded Management alerts.
- Keep credentials, raw mailbox/guest data, and finance evidence or generated
  manifests out of Git and logs. Finance source files stay read-only; follow
  the finance README's ignored-output and dry-run defaults.

## Validation

Run commands from the repository root. Select the tests for the changed area:

- Cleaner: `npm run airbnb:cleaner:test`; shared logic: `npm run airbnb:core:test`.
- Database access unit tests: `npm run airbnb:db:unit-test`.
- Stock: `npm run airbnb:stock:test`; support: `npm run airbnb:support:test`.
- Dashboard: `npm run airbnb:web:test`; finance: `npm run finance:test`.
- Combined application tests: `npm run airbnb:test`.
- Full release checks: `npm run airbnb:release:test`, which runs database tests,
  integration-enabled application tests, web lint, and the web build. This needs
  the local database runtime configured for the script's localhost connection;
  on the configured Mac, use OrbStack. Never substitute a production database.
- For documentation-only edits, verify paths, links, and documented commands,
  and run `git diff --check`; application or live-service tests are unnecessary.

## Keep Guidance Current

Always check whether the work or verified discoveries affect this file, relevant
skills, or linked instructions. Before completing authorized implementation,
update affected repository ownership, paths, commands, account routes, workflows,
validation, and durable operating rules in the same change. Correct relevant
stale guidance encountered; leave accurate guidance unchanged.

Keep project rules here and reusable procedures in maintained skills; link to
canonical details instead of duplicating runbooks. Edit maintained sources and
regenerate derived instructions rather than patching generated files or plugin
caches. Keep changing runtime status in dated operational records. Respect
planning, read-only, and explicit scope limits, and report necessary updates
that could not be completed without expanding authorization.
