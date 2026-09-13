# Airbnb support

Private Fly worker for Tristan's Airbnb conversation stream.

- Every Airbnb `Host` event is treated as a human reply; the worker never tries to infer whether Tristan or Jane typed it.
- OpenAI Responses calls use `gpt-5.6-sol`, xhigh reasoning, strict JSON schema, `store: false`, and no tools.
- One adaptive model decision receives all stored conversation messages, stay phase, guest and listing identity, current property facts, hosting knowledge, and any active timing request. It decides whether a reply is needed, whether it can be sent now, whether Management should be alerted, and what the natural reply should say. There is no topic classifier or reply allowlist. Stored context cannot replace missing Airbnb-only host messages: reconcile those explicitly before restarting after a context incident.
- Decision context also includes this thread's verified sent replies, using reviewed final text when present and the recorded send time. Draft, failed, cancelled and ambiguous deliveries are excluded. Only identical text, direction and timestamp tuples collapse; repeated messages at different times remain visible. Reading this history does not change host-reply authority timestamps, activation cutoffs, holds or delivery status.
- That same full-context response extracts nullable `roomTimingRequest` text for the existing room-policy functions: office-only arrival, departure, or pickup times do not trigger studio timing rules; genuine mixed studio requests retain their own times and conditions. Unchanged active office arrangements reuse their request and notification across message fingerprints, comparing action, actual date, nullable times, and office location before superseding a row. Changed arrangements follow the existing replacement notification path. A no-reply acknowledgement of an established office arrangement stays quiet without a host alert; genuine room-timing requests retain forced safety handling.
- Contextual acceptance of a host's timing counteroffer uses the accepted offered clock, even when the guest does not repeat it. This room-timing path is independent of office-storage permission. A newly accepted conditional time creates the existing durable cleaner operation; unrelated courtesy and acknowledgements of an unchanged active arrangement do not invent another request. An unparseable room extraction retains any recognized original timing guard, or holds the request for human review if neither can be interpreted safely.
- A `closed` support thread is an explicit conversational hold. Mail ingestion preserves it, queued delivery cannot claim it, and it cannot trigger a readiness prompt. Reopen only on the owner's instruction; this hold does not alter Airbnb's native scheduled feedback messages.
- Post-stay collection or office-storage questions do not inherit early-check-in or late-checkout rules. Use current collection facts and the conversation instead of granting new room entry.
- Post-stay replies are checked for contradictory future tense and clear name/emoji tone misses. The same model gets one natural revision attempt; a still-inconsistent draft is held and alerted instead of being sent.
- The small canonical knowledge module holds stable hosting policy and anonymized precedents. Current property facts remain the source for Wi-Fi, access, directions, parking, and other details that can change.
- Early check-in is conditional from 13:00 and creates one durable cleaner note, one verified cleaner notification, and an early-arrival readiness check one hour beforehand. The initial note and day-of readiness prompt both use English and isiXhosa; the prompt retains the exact unit-ready reply cue. Late check-out requests are politely declined.
- When current `officeLuggageStorage` facts allow it, office storage is always welcome at the verified location, independently of studio checkout. It does not grant studio entry or extend checkout, and does not establish staffed hours or lost-property collection availability. The full-context decision returns nullable `officeStorageArrangement: {date, dropTime}` for accepted/contextual arrangements: clarify an unknown date, allow an unknown drop-off time, and never use a pickup-until time or invent a default. The existing `bag_drop` request uses action `accept_office_storage`, the actual arrangement date (not automatically arrival), nullable times, and no readiness check. It retains the durable bilingual note, immediate verified cleaning-team notification, dedupe, and dated cleaner-plan inclusion. Studio storage still waits for the previous guest's actual departure, normally from 10:00; genuine early room entry retains its independent readiness flow.
- General post-stay improvement feedback without a named actionable issue is eligible for an automatic warm thank-you, gentle apology, and commitment to learn. Specific safety, maintenance, refund, reservation, or urgent issues still require the relevant grounded response and Management action.
- A cleaner must explicitly say the named unit is ready before the guest is told it is ready, and that message is never queued before 13:00. Without a cleaner response, the worker stays quiet unless the guest follows up.
- Cleaning-team evidence reads have a separate 30-second deadline and identify a timeout as `WHATSAPP_EVIDENCE_READ_TIMEOUT`. This does not extend WhatsApp write/readback or Gmail deadlines and does not retry a send. The transport normalizes Min's Unix-second message timestamps before the existing post-prompt readiness comparison; malformed timestamps never prove readiness.
- Tristan and Jane Gmail imports have a 45-second deadline per attempt and one fresh-client retry for transient failures. Canonical and lifecycle imports for Tristan are sequenced. Permanent authentication failures are not retried. Every receipt retains retry counters and credential-free mailbox failure identities, including exhausted failures. OpenAI requests default to 25 seconds and live delivery is limited to one guarded reply per run.
- A failed IMAP SEARCH is not an empty mailbox. Non-array SEARCH results fail closed as `IMAP_SEARCH_FAILED` in imports and Sent-mail guards, so they cannot supply an empty-success cursor watermark or permit SMTP without host-reply evidence. The provider does not retain the underlying failure reason in this result, so it is not automatically classified as transient or retried.
- Each mailbox's conversation import cursor is the later of its actual conversation evidence and a qualifying empty scan's durable support-run `started_at`, never its completion time. Both the job and receipt must be `success`: Tristan requires numeric `canonicalEmailsFound: 0`; Jane requires numeric `supplementalEmailsFound: 0` and `supplementalMailboxStatus.status: "enabled"`. Missing legacy fields, failed whole runs, and error/disabled Jane scans cannot advance that mailbox; nonempty imports (including capped imports) rely only on actual evidence. With neither evidence nor a qualifying empty scan, the first import still covers 90 days. Subsequent imports retain the default 360-minute overlap. `latestConversationEvidenceAt()` remains evidence-only. Success and failure receipts record the selected Jane lookback as `supplementalSearchSince` (null when not selected), without mailbox addresses or message content.
- Tristan's `express@airbnb.com` copy is always the SMTP thread target. Jane's trusted Airbnb copies are supplemental veto evidence only, so a newer host or guest event can stop delivery without rerouting the reply through Jane's mailbox.
- Trusted initial inquiry notices from `automated@airbnb.com` are ingested even before an SMTP-capable thread copy exists. The agent drafts the response and alerts Management, but cannot email the guest until Airbnb supplies the matching `express@airbnb.com` route; both copies converge into one conversation and delivery.
- An ambiguous SMTP result never retries automatically. It raises one Management alert and must be marked sent, explicitly retried, or cancelled from the dashboard after Sent mail is checked.
- Management delivery is limited to one verified WhatsApp alert per run.
- The deployed service defaults to `shadow` mode. Live execution fails closed unless the global confirmation gate and the separate reviewed-delivery, autonomous-reply, or Management-alert switches are explicitly enabled.
- Existing classifier-era drafts can never become autonomous replies after deployment. Only a fresh versioned adaptive-agent decision or an explicit cleaner-readiness decision may enter the guarded delivery queue automatically.
- Guest replies contain no AI disclaimer or automated-reply footer.
- An OpenAI failure creates a private human-review decision and no guest send. Keep the schedule dormant whenever the Tristan/Jane host-reply round-trip evidence is incomplete.

With the support schedule paused, `AIRBNB_SUPPORT_BACKFILL_CONFIRMATION=RUN_WITH_SUPPORT_SCHEDULE_PAUSED node backfill.mjs` imports historical Airbnb conversation evidence from Tristan and Jane in bounded batches. It writes no guest or WhatsApp messages and is safe to rerun.

For a recovery, keep both schedules paused while reconciling UI-only host replies,
explicit holds, and old approved deliveries. Set the activation cutoff to the
reviewed restart boundary so stale guest messages are not answered in bulk.
Then verify a controlled shadow run and a controlled live run before enabling
the five-minute live schedule. A healthy Fly machine alone is not a running
guest-reply service. Report any unresolved infrastructure root cause separately
from a successful controlled recovery.

## Deployment Context

Support imports the shared packages, so build it from the repository root.
After the scoped Fly identity and app-status checks, use this command on the
configured Mac:

```sh
/Users/tristdrum/.local/bin/fly-personal deploy . --app tristdrum-airbnb-support --config apps/airbnb-support/fly.toml --dockerfile apps/airbnb-support/Dockerfile --remote-only --ha=false --yes
```

Apply reviewed database migrations before deploying a worker that consumes them.
Retain the existing single warm machine and verify the effective activation
cutoff inside the deployed process. During a paused recovery, the initial shadow
run may spend longer ingesting accumulated mail than an ordinary poll: inspect
durable ingestion progress before treating it as stuck, and never overlap a
second invocation. Verify final receipts before enabling the schedule.
