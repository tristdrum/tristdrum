# Airbnb support shadow

Private Fly worker for Tristan's canonical `express@airbnb.com` conversation stream.

- Every Airbnb `Host` event is treated as a human reply; the worker never tries to infer whether Tristan or Jane typed it.
- OpenAI Responses calls use strict JSON schema, `store: false`, low reasoning, and no tools.
- The deployed HTTP API accepts only `shadow` mode. It can ingest, classify, draft, and record suppressed alerts, but it cannot send a guest reply or WhatsApp message.
- Drafts end with `Automated reply on behalf of your hosts.` when and only when verified facts make the low-risk topic eligible.
