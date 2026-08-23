# Airbnb stock observer

Private Fly worker for Jane's Sixty60 evidence and seven-day Airbnb stock forecasts.

- Confirmations create provisional order records because they contain no delivery address.
- Only invoices for `1 Bowie` credit inventory.
- Other-address invoices are retained as ignored evidence and never affect Airbnb stock.
- Exact, verified mini-chocolate pack variants are converted to individual guest portions. Ambiguous packs remain unquantified instead of inventing a piece count, and historical replays post idempotent compensating movements when parser knowledge changes.
- The deployed service is observation-only: it records suppressed alerts and cannot place orders or send WhatsApp messages.
