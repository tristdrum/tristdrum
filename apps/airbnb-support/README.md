# Airbnb support

Private Fly worker for Tristan's canonical `express@airbnb.com` conversation stream.

- Every Airbnb `Host` event is treated as a human reply; the worker never tries to infer whether Tristan or Jane typed it.
- OpenAI Responses calls use strict JSON schema, `store: false`, low reasoning, and no tools.
- The model writes a short, friendly draft for any case it can answer honestly. Model prose stays review-only; automatic replies still come from verified facts or an explicitly approved timing policy.
- The small canonical knowledge module holds stable hosting policy and anonymized precedents. Current property facts remain the source for Wi-Fi, access, directions, parking, and other details that can change.
- Early check-in is conditional from 13:00 and creates one durable cleaner note, one verified cleaner notification, and an early-arrival readiness check one hour beforehand. Late check-out requests are politely declined.
- A cleaner must explicitly say the named unit is ready before the guest is told it is ready, and that message is never queued before 13:00. Without a cleaner response, the worker stays quiet unless the guest follows up.
- Tristan and Jane Gmail sources are fetched concurrently with a 30-second deadline. OpenAI requests default to 10 seconds and live delivery is limited to one guarded reply per run, keeping the worst-case work inside the scheduler's 180-second budget.
- Tristan's `express@airbnb.com` copy is always the SMTP thread target. Jane's trusted Airbnb copies are supplemental veto evidence only, so a newer host or guest event can stop delivery without rerouting the reply through Jane's mailbox.
- An ambiguous SMTP result never retries automatically. It raises one Management alert and must be marked sent, explicitly retried, or cancelled from the dashboard after Sent mail is checked.
- Management delivery is limited to one verified WhatsApp alert per run.
- The deployed service defaults to `shadow` mode. Live execution fails closed unless the global confirmation gate and the separate reviewed-delivery, autonomous-reply, or Management-alert switches are explicitly enabled.
- Existing shadow drafts never become autonomous replies merely because live mode is enabled later. They remain review-only; only a fresh, verified low-risk classification may enter the guarded delivery queue automatically.
- Drafts end with `Automated reply on behalf of your hosts.` when and only when verified facts make the low-risk topic eligible.
- Keep the schedule dormant whenever OpenAI classification is unavailable or the Tristan/Jane host-reply round-trip evidence is incomplete.

With the support schedule paused, `AIRBNB_SUPPORT_BACKFILL_CONFIRMATION=RUN_WITH_SUPPORT_SCHEDULE_PAUSED node backfill.mjs` imports historical Airbnb conversation evidence from Tristan and Jane in bounded batches. It writes no guest or WhatsApp messages and is safe to rerun.
