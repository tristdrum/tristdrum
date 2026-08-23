# Airbnb Cleaner

This is the protected personal deployment of the confirmed-only cleaner report.
It was imported from `tristdrum/min.cool` at source commit
`8626bf7afeda02f66c7e92231ff4bb0c2084fc56`, where all 45 cleaner tests passed.

The personal deployment preserves the existing parser, renderer, Gmail adapter,
retry behavior, and WhatsApp verification. Supabase `airbnb.cleaner_plans` is the
delivery-ledger authority; the volume JSONL remains a rollback mirror until the
post-cutover rollback window closes. Live delivery fails closed when the shared
ledger cannot be loaded.
