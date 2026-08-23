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
