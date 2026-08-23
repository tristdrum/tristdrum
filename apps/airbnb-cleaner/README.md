# Airbnb Cleaner

This is the protected personal deployment of the confirmed-only cleaner report.
It was imported from `tristdrum/min.cool` at source commit
`8626bf7afeda02f66c7e92231ff4bb0c2084fc56`, where all 45 cleaner tests passed.

The personal deployment preserves the existing parser, renderer, Gmail adapter,
retry behavior, and WhatsApp verification. Supabase `airbnb.cleaner_plans` is the
delivery-ledger authority; the volume JSONL remains a rollback mirror until the
post-cutover rollback window closes. Live delivery fails closed when the shared
ledger cannot be loaded.

Scheduled attempts reuse a content-occurrence WhatsApp idempotency key, so
retries remain stable while a later `B -> C -> B` reversion gets a new key. Final
failure alerts are sent only to the private destination and count as delivered
only after exact chat readback. Live failures are mirrored into sanitized
Supabase job receipts even when plan generation does not complete.
