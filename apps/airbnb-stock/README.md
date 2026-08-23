# Airbnb stock observer

Private Fly worker for Jane's Sixty60 evidence and seven-day Airbnb stock forecasts.

- Confirmations create provisional order records because they contain no delivery address.
- Only invoices that explicitly identify `1 Bowie Street` credit inventory.
- Other-address invoices are retained as ignored evidence and never affect Airbnb stock.
- Exact, verified mini-chocolate pack variants are converted to individual guest portions. Ambiguous packs remain unquantified instead of inventing a piece count, and historical replays post idempotent compensating movements when parser knowledge changes.
- Observation remains the default. A separately gated live mode can send suppressed stock and order alerts to the Airbnb Management group with verified readback; order placement is always disabled.
- The observer reads the Airbnb Maids and Airbnb Management groups as evidence only. A shortage message stores a hash and matched stock codes, never its raw body, and only marks those items as counts to confirm; it cannot move inventory or place an order.
- Physical counts are authoritative snapshots: evidence for an earlier event cannot rewrite them, and shortage messages older than the count cannot invalidate them. Confirmed counts become stale after 30 days by default.
- Historical prices are informational. Every shopping list reminds the human to confirm that the current basket is at least R350 and to target about R400.
- `airbnb-stock-management-alerts-10-40` is the only scheduled live path. Keep it inactive until the two-person Management group, exact destination ID, and every external-write gate are verified; it sends at most one alert per run.
