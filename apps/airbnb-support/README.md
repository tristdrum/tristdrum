# Airbnb support shadow

Private Fly worker for Tristan's canonical `express@airbnb.com` conversation stream.

- Every Airbnb `Host` event is treated as a human reply; the worker never tries to infer whether Tristan or Jane typed it.
- OpenAI Responses calls use strict JSON schema, `store: false`, low reasoning, and no tools.
- Gmail sources are fetched in one bounded batch. The whole import defaults to a 60-second deadline and each OpenAI request to 30 seconds, keeping both classification waves inside the scheduler's 180-second budget.
- The deployed HTTP API accepts only `shadow` mode. It can ingest, classify, draft, and record suppressed alerts, but it cannot send a guest reply or WhatsApp message.
- Drafts end with `Automated reply on behalf of your hosts.` when and only when verified facts make the low-risk topic eligible.
