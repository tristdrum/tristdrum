import assert from "node:assert/strict";
import test from "node:test";
import { AUTOMATED_REPLY_FOOTER } from "@tristdrum/airbnb-core";
import { classifyGuestMessage } from "./classifier.mjs";

test("classifier uses strict, non-stored Responses API output and adds the footer", async () => {
  let requestBody;
  const result = await classifyGuestMessage({
    guestMessage: "What time is checkout?",
    listingName: "Jasmine Studio Stay",
    facts: { checkOutTime: "10:00" },
    env: { OPENAI_API_KEY: "test-key", AIRBNB_SUPPORT_OPENAI_MODEL: "gpt-5.6-terra" },
    fetchFn: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            output: [{ content: [{ type: "output_text", text: JSON.stringify({
              topic: "check_out_time",
              riskTier: "low",
              confidence: 0.99,
              factsVerified: true,
              replyNeeded: true,
              summary: "Guest asks for checkout time.",
              draft: "Checkout is at 10:00.",
            }) }] }],
          };
        },
      };
    },
  });
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.reasoning.effort, "low");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.tools, undefined);
  const input = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(input.canonicalKnowledge.sharedFacts.standardCheckInTime, "15:00");
  assert.equal(input.canonicalKnowledge.property.listingName, "Jasmine Studio Stay");
  assert.deepEqual(input.verifiedPropertyFacts, { checkOutTime: "10:00" });
  assert.equal(result.autoReply, true);
  assert.equal(result.messageWhitelisted, true);
  assert.ok(result.draft.endsWith(AUTOMATED_REPLY_FOOTER));
});

test("model confidence cannot make an unconfigured Wi-Fi fact safe", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "What is the Wi-Fi password?",
    listingName: "Spekboom",
    facts: {},
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "wifi",
          riskTier: "low",
          confidence: 1,
          factsVerified: true,
          replyNeeded: true,
          summary: "Wi-Fi request.",
          draft: "Use a guessed password.",
        }) };
      },
    }),
  });
  assert.equal(result.factsVerified, false);
  assert.equal(result.autoReply, false);
  assert.equal(result.status, "needs_human");
});

test("verified templates replace model prose before autonomous approval", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Hello, we are looking forward to the stay.",
    listingName: "Jasmine Studio Stay",
    facts: {},
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "greeting",
          riskTier: "low",
          confidence: 1,
          factsVerified: true,
          replyNeeded: true,
          summary: "Greeting.",
          draft: "Your refund is approved and your dates are changed.",
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, true);
  assert.match(result.draft, /^Hello! Thank you for your message\./);
  assert.doesNotMatch(result.draft, /refund|dates are changed/i);
  assert.equal(result.deterministicGuard, "verified_template");
});

test("high-risk guest language forces human review despite a low-risk model label", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Hello, please refund me and change my booking dates.",
    listingName: "Jasmine Studio Stay",
    facts: {},
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "greeting",
          riskTier: "low",
          confidence: 1,
          factsVerified: true,
          replyNeeded: true,
          summary: "Greeting.",
          draft: "Hello!",
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.status, "needs_human");
  assert.equal(result.alertManagement, true);
  assert.equal(result.deterministicGuard, "human_review_phrase");
});

test("classifier keeps a useful model draft for human-review booking cases", async () => {
  const draft = "Thanks for checking. Could you confirm which night you would like so we can check availability?";
  const result = await classifyGuestMessage({
    guestMessage: "Can I book for tomorrow or the next day?",
    listingName: "Bougainvillea Courtyard Studio",
    facts: {},
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "booking",
          riskTier: "high",
          confidence: 0.98,
          factsVerified: false,
          replyNeeded: true,
          summary: "The requested booking date is ambiguous.",
          draft,
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.status, "needs_human");
  assert.equal(result.draft, draft);
  assert.doesNotMatch(result.draft, new RegExp(AUTOMATED_REPLY_FOOTER));
});

test("canonical and property-fact conflicts block an otherwise autonomous reply", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "What time is check-in?",
    listingName: "The Spekboom Studio",
    facts: { checkInTime: "14:00" },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "check_in_time",
          riskTier: "low",
          confidence: 1,
          factsVerified: true,
          replyNeeded: true,
          summary: "The guest asks for check-in time, but the sources conflict.",
          draft: "Thanks for checking. Let me confirm the correct check-in time for you.",
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.factsVerified, false);
  assert.equal(result.deterministicGuard, "knowledge_conflict");
  assert.match(result.draft, /confirm the correct check-in time/i);
  assert.doesNotMatch(result.draft, /14:00|15:00/);
});

test("an unknown listing blocks property-specific autonomy but not a helpful draft", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "What is the address?",
    listingName: "Unknown listing",
    facts: { address: "Verified runtime address" },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "address",
          riskTier: "low",
          confidence: 1,
          factsVerified: true,
          replyNeeded: true,
          summary: "Address request for an unrecognised listing.",
          draft: "Let me confirm which studio you booked so I can send the right address.",
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.deterministicGuard, "listing_not_recognized");
  assert.match(result.draft, /which studio/i);
});

test("model topic labels cannot bypass cancellation, change, maintenance, or ambiguity review", async () => {
  const cases = [
    ["Thanks, I won't be coming after all", "thanks", "human_review_phrase"],
    ["Please modify my reservation", "greeting", "human_review_phrase"],
    ["I need to shorten my stay", "thanks", "human_review_phrase"],
    ["There is no hot water", "greeting", "human_review_phrase"],
    ["Could you help me with something?", "greeting", "message_not_whitelisted"],
  ];
  for (const [guestMessage, topic, expectedGuard] of cases) {
    const result = await classifyGuestMessage({
      guestMessage,
      listingName: "Jasmine Studio Stay",
      facts: {},
      env: { OPENAI_API_KEY: "test-key" },
      fetchFn: async () => ({
        ok: true,
        async json() {
          return { output_text: JSON.stringify({
            topic,
            riskTier: "low",
            confidence: 1,
            factsVerified: true,
            replyNeeded: true,
            summary: "The model incorrectly called this low risk.",
            draft: "You are very welcome.",
          }) };
        },
      }),
    });
    assert.equal(result.messageWhitelisted, false, guestMessage);
    assert.equal(result.autoReply, false, guestMessage);
    assert.equal(result.status, "needs_human", guestMessage);
    assert.equal(result.riskTier, "high", guestMessage);
    assert.equal(result.deterministicGuard, expectedGuard, guestMessage);
  }
});

test("classifier respects the scheduler-safe request deadline", async () => {
  await assert.rejects(
    classifyGuestMessage({
      guestMessage: "Hello?",
      listingName: "Jasmine Studio Stay",
      facts: {},
      env: {
        OPENAI_API_KEY: "test-key",
        AIRBNB_SUPPORT_OPENAI_TIMEOUT_MS: "10",
      },
      fetchFn: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }),
    { name: "TimeoutError" },
  );
});

test("approved early check-in policy is deterministic and does not call the model", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Could we please check in early at 2pm?",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(result.topic, "early_check_in");
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.effectiveTime, "14:00");
  assert.equal(result.operationalRequest.createsOperationalRequest, true);
  assert.match(result.draft, /cannot be guaranteed/i);
  assert.ok(result.draft.endsWith(AUTOMATED_REPLY_FOOTER));
});

test("a mixed early-check-in and complaint message stays human-reviewed", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "The room is dirty. Could we check in early at 2pm?",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00" },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "complaint",
          riskTier: "high",
          confidence: 0.99,
          factsVerified: false,
          replyNeeded: true,
          summary: "The guest reports a cleanliness problem and also asks about arrival time.",
          draft: "I’m sorry about this. Let me check both the room and your arrival request right away.",
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.status, "needs_human");
  assert.equal(result.deterministicGuard, "human_review_phrase");
});

test("late checkout is politely declined without notifying cleaners", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Can we have a late checkout at 11am?",
    listingName: "The Spekboom Studio",
    facts: { checkOutTime: "10:00" },
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "decline");
  assert.equal(result.operationalRequest.createsOperationalRequest, false);
  assert.equal(result.operationalRequest.needsCleanerNotification, false);
  assert.match(result.draft, /standard check-out is by 10:00/i);

  const halfPast = await classifyGuestMessage({
    guestMessage: "Can we have a late checkout at 10:30am?",
    listingName: "The Spekboom Studio",
    facts: { checkOutTime: "10:00" },
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(halfPast.autoReply, true);
  assert.equal(halfPast.operationalRequest.action, "decline");
});

test("timing replies need current property times before they can be autonomous", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Can we have a late checkout at 11am?",
    listingName: "The Spekboom Studio",
    facts: {},
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.status, "needs_human");
  assert.equal(result.factsVerified, false);
  assert.equal(result.deterministicGuard, "time_policy_not_verified");
  assert.equal(result.operationalRequest, null);
  assert.doesNotMatch(result.draft, new RegExp(AUTOMATED_REPLY_FOOTER));

  const conflicting = await classifyGuestMessage({
    guestMessage: "Can we have a late checkout at 11am?",
    listingName: "The Spekboom Studio",
    facts: { checkOutTime: "11:00" },
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(conflicting.autoReply, false);
  assert.equal(conflicting.deterministicGuard, "time_policy_not_verified");
});

test("a legacy late-checkout promise stays honoured without creating another cleaner instruction", async () => {
  const activeTimeRequest = {
    requestType: "late_checkout",
    stayDate: "2026-08-24",
    effectiveTime: "11:00",
    status: "cleaners_notified",
  };
  const repeated = await classifyGuestMessage({
    guestMessage: "Can we have a late checkout at 11am?",
    listingName: "The Spekboom Studio",
    facts: { checkOutTime: "10:00" },
    activeTimeRequest,
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(repeated.operationalRequest.action, "preserve_existing");
  assert.equal(repeated.operationalRequest.createsOperationalRequest, false);
  assert.equal(repeated.operationalRequest.cancelsOperationalRequest, false);
  assert.match(repeated.draft, /agreed check-out at 11:00 is still in place/i);

  const later = await classifyGuestMessage({
    guestMessage: "Can we check out at 12pm instead?",
    listingName: "The Spekboom Studio",
    facts: { checkOutTime: "10:00" },
    activeTimeRequest,
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(later.operationalRequest.action, "preserve_existing");
  assert.equal(later.operationalRequest.cancelsOperationalRequest, false);
  assert.match(later.draft, /can['’]t extend check-out beyond the already agreed 11:00/i);

  const standard = await classifyGuestMessage({
    guestMessage: "Can we check out at 10am instead?",
    listingName: "The Spekboom Studio",
    facts: { checkOutTime: "10:00" },
    activeTimeRequest,
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(standard.operationalRequest.action, "standard_time");
  assert.equal(standard.operationalRequest.cancelsOperationalRequest, true);
});

test("returning to the standard time retracts an active cleaner instruction", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Can we check in at 3pm instead?",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    activeTimeRequest: {
      requestType: "early_checkin",
      stayDate: "2026-08-24",
      effectiveTime: "13:00",
      status: "cleaners_notified",
    },
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "standard_time");
  assert.equal(result.operationalRequest.cancelsOperationalRequest, true);
});

test("an early check-in follow-up uses the approved fallback after the requested time", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Can we check in now?",
    listingName: "Jasmine Studio Stay",
    facts: {},
    activeTimeRequest: {
      requestType: "early_checkin",
      stayDate: "2026-08-24",
      effectiveTime: "13:00",
      status: "awaiting_ready",
    },
    now: new Date("2026-08-24T13:05:00+02:00"),
    env: {},
    fetchFn: async () => { throw new Error("model must not be called"); },
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "no_cleaner_response");
  assert.match(result.draft, /should be able to go through/i);
});

test("an old early check-in request cannot answer a later-day follow-up", async () => {
  const result = await classifyGuestMessage({
    guestMessage: "Can we check in now?",
    listingName: "Jasmine Studio Stay",
    facts: {},
    activeTimeRequest: {
      requestType: "early_checkin",
      stayDate: "2026-08-23",
      effectiveTime: "13:00",
      status: "awaiting_ready",
    },
    now: new Date("2026-08-24T13:05:00+02:00"),
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({
          topic: "early_check_in_follow_up",
          riskTier: "unknown",
          confidence: 0.7,
          factsVerified: false,
          replyNeeded: true,
          summary: "The request date is unclear.",
          draft: "Let me confirm that for you.",
        }) };
      },
    }),
  });
  assert.equal(result.autoReply, false);
});
