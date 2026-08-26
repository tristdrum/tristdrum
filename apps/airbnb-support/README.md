# Airbnb support

Private Fly worker for Tristan's Airbnb conversation stream.

- Every Airbnb `Host` event is treated as a human reply; the worker never tries to infer whether Tristan or Jane typed it.
- OpenAI Responses calls use `gpt-5.6-sol`, xhigh reasoning, strict JSON schema, `store: false`, and no tools.
- One adaptive model decision receives the complete recent conversation, stay phase, guest and listing identity, current property facts, hosting knowledge, and any active timing request. It decides whether a reply is needed, whether it can be sent now, whether Management should be alerted, and what the natural reply should say. There is no topic classifier or reply allowlist.
- Post-stay replies are checked for contradictory future tense and clear name/emoji tone misses. The same model gets one natural revision attempt; a still-inconsistent draft is held and alerted instead of being sent.
- The small canonical knowledge module holds stable hosting policy and anonymized precedents. Current property facts remain the source for Wi-Fi, access, directions, parking, and other details that can change.
- Early check-in is conditional from 13:00 and creates one durable cleaner note, one verified cleaner notification, and an early-arrival readiness check one hour beforehand. Late check-out requests are politely declined.
- A cleaner must explicitly say the named unit is ready before the guest is told it is ready, and that message is never queued before 13:00. Without a cleaner response, the worker stays quiet unless the guest follows up.
- Tristan and Jane Gmail sources are fetched concurrently with a 30-second deadline. OpenAI requests default to 25 seconds and live delivery is limited to one guarded reply per run, keeping work inside the scheduler's 180-second budget.
- Tristan's `express@airbnb.com` copy is always the SMTP thread target. Jane's trusted Airbnb copies are supplemental veto evidence only, so a newer host or guest event can stop delivery without rerouting the reply through Jane's mailbox.
- Trusted initial inquiry notices from `automated@airbnb.com` are ingested even before an SMTP-capable thread copy exists. The agent drafts the response and alerts Management, but cannot email the guest until Airbnb supplies the matching `express@airbnb.com` route; both copies converge into one conversation and delivery.
- An ambiguous SMTP result never retries automatically. It raises one Management alert and must be marked sent, explicitly retried, or cancelled from the dashboard after Sent mail is checked.
- Management delivery is limited to one verified WhatsApp alert per run.
- The deployed service defaults to `shadow` mode. Live execution fails closed unless the global confirmation gate and the separate reviewed-delivery, autonomous-reply, or Management-alert switches are explicitly enabled.
- Existing classifier-era drafts can never become autonomous replies after deployment. Only a fresh versioned adaptive-agent decision or an explicit cleaner-readiness decision may enter the guarded delivery queue automatically.
- Guest replies contain no AI disclaimer or automated-reply footer.
- An OpenAI failure creates a private human-review decision and no guest send. Keep the schedule dormant whenever the Tristan/Jane host-reply round-trip evidence is incomplete.

With the support schedule paused, `AIRBNB_SUPPORT_BACKFILL_CONFIRMATION=RUN_WITH_SUPPORT_SCHEDULE_PAUSED node backfill.mjs` imports historical Airbnb conversation evidence from Tristan and Jane in bounded batches. It writes no guest or WhatsApp messages and is safe to rerun.
