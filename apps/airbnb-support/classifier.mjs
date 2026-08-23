import {
  supportDisposition,
  supportMessageMatchesTopic,
  supportMessageRequiresHuman,
  verifiedSupportDraft,
  withAutomatedReplyFooter,
} from "@tristdrum/airbnb-core";

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
        "exception", "unknown",
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

export async function classifyGuestMessage({
  guestMessage,
  listingName,
  facts,
  env = process.env,
  fetchFn = fetch,
}) {
  const model = String(env.AIRBNB_SUPPORT_OPENAI_MODEL ?? "gpt-5.6-terra");
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
                "Only draft from the supplied verified facts. Use null for draft when a safe factual reply cannot be written.",
                "Only a simple greeting, thanks, or direct request for standard Wi-Fi, address, directions, parking, check-in, check-out, or resend information can ever be autonomous.",
                "Cancellation, reservation changes, maintenance, complaints, mixed requests, and ambiguous wording always require a human.",
                "A draft is advisory only and must be concise, warm, and direct.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({ listingName, guestMessage, verifiedFacts: facts }),
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
  const deterministicDraft = verifiedSupportDraft(raw.topic, facts);
  const explicitHumanReview = supportMessageRequiresHuman(guestMessage);
  const messageWhitelisted = supportMessageMatchesTopic(guestMessage, raw.topic);
  const requiresHuman = explicitHumanReview || !messageWhitelisted;
  const classification = {
    ...raw,
    riskTier: requiresHuman ? "high" : raw.riskTier,
    messageWhitelisted,
    factsVerified: !requiresHuman
      && raw.factsVerified === true
      && factAvailable(raw.topic, facts)
      && deterministicDraft != null,
    draft: deterministicDraft ?? raw.draft,
    deterministicGuard: explicitHumanReview
      ? "human_review_phrase"
      : !messageWhitelisted
        ? "message_not_whitelisted"
        : deterministicDraft
          ? "verified_template"
          : "no_verified_template",
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
