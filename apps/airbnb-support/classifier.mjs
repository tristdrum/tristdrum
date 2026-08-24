import {
  supportDisposition,
  supportMessageMatchesTopic,
  supportMessageRequiresHuman,
  supportTimeFollowUpDecision,
  supportTimeRequestIsFocused,
  supportTimeRequestDecision,
  verifiedSupportDraft,
  withAutomatedReplyFooter,
} from "@tristdrum/airbnb-core";
import { normalizedClock, supportKnowledgeForListing } from "./knowledge.mjs";

const PROPERTY_FACT_TOPICS = Object.freeze(new Set([
  "wifi",
  "address",
  "directions",
  "parking",
  "verified_amenity",
  "check_in_time",
  "check_out_time",
  "resend_standard_info",
]));

export const CLASSIFICATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["topic", "riskTier", "confidence", "factsVerified", "replyNeeded", "summary", "draft"],
  properties: {
    topic: {
      type: "string",
      enum: [
        "wifi", "address", "directions", "parking", "verified_amenity", "check_in_time",
        "check_out_time", "greeting", "thanks", "resend_standard_info", "booking",
        "availability", "pricing", "refund", "date_change", "complaint", "safety",
        "exception", "early_check_in", "late_check_out", "early_check_in_follow_up", "unknown",
      ],
    },
    riskTier: { type: "string", enum: ["low", "high", "unknown"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    factsVerified: { type: "boolean" },
    replyNeeded: { type: "boolean" },
    summary: { type: "string", maxLength: 300 },
    draft: { type: ["string", "null"], maxLength: 1500 },
  },
});

function required(name, env) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function responseText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain structured output text.");
}

function factAvailable(topic, facts) {
  if (["greeting", "thanks"].includes(topic)) return true;
  if (topic === "wifi") return Boolean(facts.wifi);
  if (topic === "address") return Boolean(facts.address);
  if (topic === "directions") return Boolean(facts.directions);
  if (topic === "parking") return Boolean(facts.parking);
  if (topic === "verified_amenity") return Array.isArray(facts.amenities) && facts.amenities.length > 0;
  if (topic === "check_in_time") return Boolean(facts.checkInTime);
  if (topic === "check_out_time") return Boolean(facts.checkOutTime);
  if (topic === "resend_standard_info") return Boolean(facts.standardInfo);
  return false;
}

function knowledgeGuard(topic, knowledge) {
  if (knowledge.conflicts.some((conflict) => conflict.topics.includes(topic))) {
    return "knowledge_conflict";
  }
  if (PROPERTY_FACT_TOPICS.has(topic) && !knowledge.listingRecognized) {
    return "listing_not_recognized";
  }
  return null;
}

function timePolicyFactsVerified(decision, facts, knowledge) {
  if (!knowledge.listingRecognized) return false;
  if (decision.topic === "early_check_in_follow_up") return true;
  const keys = decision.requestType === "early_checkin"
    ? ["checkInTime", "checkOutTime"]
    : ["checkOutTime"];
  return keys.every((key) => normalizedClock(facts[key]))
    && !knowledge.conflicts.some((conflict) => keys.includes(conflict.key));
}

function reconcileExistingTimePromise(decision, activeTimeRequest) {
  if (!decision || decision.requestType !== "late_checkout" || activeTimeRequest?.requestType !== "late_checkout") {
    return decision;
  }
  const agreedTime = normalizedClock(activeTimeRequest.effectiveTime);
  if (!agreedTime || decision.action === "standard_time") return decision;
  const requestedTime = normalizedClock(decision.requestedTime);
  return {
    ...decision,
    action: "preserve_existing",
    effectiveTime: agreedTime,
    createsOperationalRequest: false,
    needsCleanerNotification: false,
    reply: requestedTime && requestedTime > agreedTime
      ? `I’m sorry, but we can’t extend check-out beyond the already agreed ${agreedTime}.`
      : `Your agreed check-out at ${agreedTime} is still in place.`,
  };
}

export async function classifyGuestMessage({
  guestMessage,
  listingName,
  facts,
  activeTimeRequest = null,
  conversationContext = [],
  now = new Date(),
  env = process.env,
  fetchFn = fetch,
}) {
  const model = String(env.AIRBNB_SUPPORT_OPENAI_MODEL ?? "gpt-5.6-terra");
  const verifiedFacts = facts && typeof facts === "object" ? facts : {};
  const knowledge = supportKnowledgeForListing({ listingName, propertyFacts: verifiedFacts });
  const timeDecision = reconcileExistingTimePromise(
    supportTimeRequestDecision(guestMessage, verifiedFacts)
      ?? supportTimeFollowUpDecision(guestMessage, activeTimeRequest, now),
    activeTimeRequest,
  );
  if (timeDecision && supportTimeRequestIsFocused(guestMessage)) {
    const timeFactsVerified = timePolicyFactsVerified(timeDecision, verifiedFacts, knowledge);
    const cancelsOperationalRequest = (
      timeFactsVerified
      && activeTimeRequest?.requestType === timeDecision.requestType
      && !timeDecision.createsOperationalRequest
      && timeDecision.action === "standard_time"
    );
    const classification = {
      topic: timeDecision.topic,
      riskTier: timeFactsVerified ? "low" : "high",
      confidence: 1,
      factsVerified: timeFactsVerified,
      replyNeeded: true,
      summary: timeDecision.requestType === "early_checkin"
        ? "The guest asked about early check-in."
        : "The guest asked about late check-out.",
      draft: timeFactsVerified
        ? timeDecision.reply
        : knowledge.listingRecognized
          ? "Let me confirm the current check-in or check-out arrangements and get back to you."
          : "Could you please confirm which studio this is for?",
      messageWhitelisted: true,
      deterministicGuard: timeFactsVerified ? "approved_time_policy" : "time_policy_not_verified",
      operationalRequest: timeFactsVerified ? { ...timeDecision, cancelsOperationalRequest } : null,
    };
    const disposition = supportDisposition(classification);
    return {
      ...classification,
      ...disposition,
      draft: disposition.autoReply
        ? withAutomatedReplyFooter(classification.draft)
        : classification.draft,
      model: null,
    };
  }
  const response = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${required("OPENAI_API_KEY", env)}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Classify one Airbnb guest message for a cautious host-support system.",
                "Never assume availability, discounts, refunds, date changes, exceptions, safety facts, or unlisted amenities.",
                "Treat canonical knowledge as policy and context, verified property facts as current details, and any listed conflict as unknown.",
                "For a conflict or missing fact, offer to check or ask one useful clarifying question instead of guessing.",
                "Whenever a reply is needed, write a concise, warm proposed reply if one can be honest, even when a human must review it.",
                "Do not promise an outcome, mention internal systems or risk labels, or expose the reasoning behind escalation.",
                "Only a simple greeting, thanks, or direct request for standard Wi-Fi, address, directions, parking, check-in, check-out, or resend information can ever be autonomous.",
                "Cancellation, reservation changes, maintenance, complaints, mixed requests, and ambiguous wording always require a human.",
                "The draft is advisory; application code independently decides whether any reply is autonomous.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({
              listingName,
              guestMessage,
              recentConversation: conversationContext,
              activeTimeRequest,
              canonicalKnowledge: knowledge,
              verifiedPropertyFacts: verifiedFacts,
            }),
          }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "airbnb_guest_triage",
          strict: true,
          schema: CLASSIFICATION_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(positiveInteger(env.AIRBNB_SUPPORT_OPENAI_TIMEOUT_MS, 10_000)),
  });
  if (!response.ok) throw new Error(`OpenAI classification failed with HTTP ${response.status}.`);
  const raw = JSON.parse(responseText(await response.json()));
  const deterministicDraft = verifiedSupportDraft(raw.topic, verifiedFacts);
  const explicitHumanReview = supportMessageRequiresHuman(guestMessage);
  const messageWhitelisted = supportMessageMatchesTopic(guestMessage, raw.topic);
  const knowledgeIssue = knowledgeGuard(raw.topic, knowledge);
  const requiresHuman = explicitHumanReview || !messageWhitelisted || Boolean(knowledgeIssue);
  const autonomousDraft = requiresHuman ? null : deterministicDraft;
  const classification = {
    ...raw,
    riskTier: requiresHuman ? "high" : raw.riskTier,
    messageWhitelisted,
    factsVerified: !requiresHuman
      && raw.factsVerified === true
      && factAvailable(raw.topic, verifiedFacts)
      && autonomousDraft != null,
    draft: autonomousDraft ?? raw.draft,
    deterministicGuard: explicitHumanReview
      ? "human_review_phrase"
      : !messageWhitelisted
        ? "message_not_whitelisted"
        : knowledgeIssue
          ?? (autonomousDraft ? "verified_template" : "no_verified_template"),
  };
  const disposition = supportDisposition(classification);
  return {
    ...classification,
    ...disposition,
    draft: classification.draft && disposition.autoReply
      ? withAutomatedReplyFooter(classification.draft)
      : classification.draft,
    model,
  };
}
