# Airbnb stock observer

Private Fly worker for Jane's Sixty60 evidence and seven-day Airbnb stock forecasts.

- Confirmations create provisional order records because they contain no delivery address.
- Only invoices for `1 Bowie` credit inventory.
- Other-address invoices are retained as ignored evidence and never affect Airbnb stock.
- Exact, verified mini-chocolate pack variants are converted to individual guest portions. Ambiguous packs remain unquantified instead of inventing a piece count, and historical replays post idempotent compensating movements when parser knowledge changes.
- Observation remains the default. A separately gated live mode can send suppressed stock and order alerts to the Airbnb Management group with verified readback; order placement is always disabled.
- The observer reads the Airbnb Maids and Airbnb Management groups as evidence only. A shortage message stores a hash and matched stock codes, never its raw body, and only marks those items as counts to confirm; it cannot move inventory or place an order.
- Confirmed physical counts become stale after 30 days by default. Shopping lists never claim the R350 free-delivery minimum while any selected item lacks a known price; the human basket should remain at least R350 and target about R400.
- The dormant `airbnb-stock-management-alerts-10-40` cron is the only scheduled live path. Activate it only after the two-person Management group, exact destination ID, and every external-write gate are verified; it sends at most one alert per run.
