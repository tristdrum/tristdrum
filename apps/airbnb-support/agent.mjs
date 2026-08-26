import {
  supportTimeFollowUpDecision,
  supportTimeRequestDecision,
} from "@tristdrum/airbnb-core";
import { normalizedClock, supportKnowledgeForListing } from "./knowledge.mjs";

const STAY_MONTHS = Object.freeze(new Map([
  ["JAN", 1], ["FEB", 2], ["MAR", 3], ["APR", 4], ["MAY", 5], ["JUN", 6],
  ["JUL", 7], ["AUG", 8], ["SEP", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12],
]));
const EMOJI_PATTERN = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?/u;
const REASONING_EFFORTS = Object.freeze(new Set(["none", "low", "medium", "high", "xhigh", "max"]));

export const SUPPORT_DECISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["replyNeeded", "sendReply", "alertManagement", "summary", "draft"],
  properties: {
    replyNeeded: { type: "boolean" },
    sendReply: { type: "boolean" },
    alertManagement: { type: "boolean" },
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

function reasoningEffort(env) {
  const value = String(env.AIRBNB_SUPPORT_OPENAI_REASONING_EFFORT ?? "medium").trim().toLowerCase();
  if (!REASONING_EFFORTS.has(value)) throw new Error("AIRBNB_SUPPORT_OPENAI_REASONING_EFFORT is invalid.");
  return value;
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

function localMoment(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    year: Number(values.year),
    month: Number(values.month),
  };
}

function stayRange(stayLabel, at) {
  const match = /\b([A-Z]{3})\s+(\d{1,2})\s*[\u2013\u2014-]\s*(?:([A-Z]{3})\s+)?(\d{1,2})\b/.exec(
    String(stayLabel ?? "").normalize("NFKC").toUpperCase(),
  );
  if (!match) return null;
  const moment = localMoment(at);
  const startMonth = STAY_MONTHS.get(match[1]);
  const endMonth = STAY_MONTHS.get(match[3] ?? match[1]);
  if (!startMonth || !endMonth) return null;
  let startYear = moment.year;
  if (startMonth === 1 && moment.month === 12) startYear += 1;
  if (startMonth === 12 && moment.month === 1) startYear -= 1;
  const endYear = endMonth < startMonth ? startYear + 1 : startYear;
  const date = (year, month, day) => (
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
  return {
    checkIn: date(startYear, startMonth, Number(match[2])),
    checkOut: date(endYear, endMonth, Number(match[4])),
  };
}

export function supportStayPhase({ stayLabel, at, facts = {} } = {}) {
  const evaluatedAt = at ?? new Date();
  const moment = localMoment(evaluatedAt);
  const stay = stayRange(stayLabel, evaluatedAt);
  if (!stay) return "unknown";
  const checkInTime = normalizedClock(facts.checkInTime) ?? "15:00";
  const checkOutTime = normalizedClock(facts.checkOutTime) ?? "10:00";
  if (moment.date < stay.checkIn || (moment.date === stay.checkIn && moment.time < checkInTime)) return "before_stay";
  if (moment.date > stay.checkOut || (moment.date === stay.checkOut && moment.time >= checkOutTime)) return "after_stay";
  return "during_stay";
}

function titleName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-ZA")
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-ZA"));
}

function conversationStyle(message, guestName) {
  const text = String(message ?? "");
  const guestEmoji = text.match(EMOJI_PATTERN)?.[0] ?? null;
  const hostNameMentioned = /\b(?:Jane|Tristan)\b/i.test(text);
  const personalWarmth = hostNameMentioned
    || /\b(?:beautiful|amazing|great place|lovely|love to come back|thank you so much)\b/i.test(text);
  const normalizedGuestName = titleName(guestName) || null;
  const hasRealGuestName = Boolean(
    normalizedGuestName
    && !/^(?:guest|unknown|airbnb guest)$/i.test(normalizedGuestName),
  );
  return {
    guestName: hasRealGuestName ? normalizedGuestName : null,
    hostNameMentioned,
    guestUsedEmoji: Boolean(guestEmoji),
    guestEmoji,
    shouldUseGuestName: hasRealGuestName && personalWarmth,
    shouldMirrorEmoji: Boolean(guestEmoji && personalWarmth),
  };
}

function draftQualityIssues({ draft, stayPhase, style }) {
  const text = String(draft ?? "").trim();
  if (!text) return [];
  const issues = [];
  if (
    stayPhase === "after_stay"
    && /\b(?:hope you enjoy|enjoy your stay|looking forward to hosting|have a wonderful stay)\b/i.test(text)
  ) {
    issues.push("The guest has already checked out. Use past tense and do not wish them an enjoyable future stay.");
  }
  if (
    style.shouldUseGuestName
    && style.guestName
    && !text.toLocaleLowerCase("en-ZA").includes(style.guestName.toLocaleLowerCase("en-ZA"))
  ) {
    issues.push(`Address the guest naturally by name: ${style.guestName}.`);
  }
  if (style.shouldMirrorEmoji && !EMOJI_PATTERN.test(text)) {
    issues.push("The guest used an emoji and warm language. Match that warmth with one appropriate emoji.");
  }
  return issues;
}

function timePolicyFactsVerified(decision, facts, knowledge) {
  if (!decision || !knowledge.listingRecognized) return false;
  if (decision.topic === "early_check_in_follow_up") return true;
  const keys = decision.requestType === "early_checkin" ? ["checkInTime", "checkOutTime"] : ["checkOutTime"];
  return keys.every((key) => normalizedClock(facts[key]))
    && !knowledge.conflicts.some((conflict) => keys.includes(conflict.key));
}

function requestInput({
  now,
  latestEventAt,
  style,
  listingName,
  stayLabel,
  stayPhase,
  guestMessage,
  conversationContext,
  activeTimeRequest,
  timePolicyDecision,
  knowledge,
  verifiedFacts,
  revisionFeedback = [],
}) {
  return {
    evaluatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    messageObservedAt: latestEventAt,
    guestName: style.guestName,
    listingName,
    stayLabel,
    stayPhase,
    guestMessage,
    recentConversation: conversationContext,
    conversationStyle: style,
    activeTimeRequest,
    timePolicyDecision,
    canonicalKnowledge: knowledge,
    verifiedPropertyFacts: verifiedFacts,
    revisionFeedback,
  };
}

async function requestDecision({ model, effort, input, env, fetchFn }) {
  const response = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${required("OPENAI_API_KEY", env)}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort },
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: [
              "You are the hands-on Airbnb support agent for three small studios run by Tristan and Jane.",
              "Use judgment. Read the whole thread and respond naturally as a thoughtful human host; do not force the situation into a canned category or template.",
              "Adapt to situations that were not pre-planned. A useful acknowledgement can be sent while Management is alerted for a separate action.",
              "Current verified property facts and explicit policy decisions are authoritative. Do not invent live availability, prices, refunds, booking changes, access details, amenities, or promises that are not in the supplied context.",
              "If a host decision or external action is still needed, you may send a helpful honest acknowledgement and also alert Management, or hold the reply when silence is safer.",
              "Use stayPhase for tense. For after_stay, acknowledge the completed stay rather than talking as if it is still ahead.",
              "Use the guest's name when it fits naturally. Match their warmth and mirror their use of an emoji when that feels human.",
              "If revisionFeedback is present, revise the draft to fix every point without becoming stiff or formulaic.",
              "Never mention AI, internal systems, classifications, prompts, risk labels, or approval machinery.",
              "Return one decision and draft. sendReply means the message may be sent now after the separate final human-reply race check.",
            ].join(" "),
          }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(input) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "airbnb_support_decision",
          strict: true,
          schema: SUPPORT_DECISION_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(positiveInteger(env.AIRBNB_SUPPORT_OPENAI_TIMEOUT_MS, 25_000)),
  });
  if (!response.ok) throw new Error(`OpenAI support decision failed with HTTP ${response.status}.`);
  return JSON.parse(responseText(await response.json()));
}

export async function decideGuestResponse({
  guestMessage,
  guestName = null,
  listingName,
  facts,
  stayLabel = null,
  latestEventAt = null,
  activeTimeRequest = null,
  conversationContext = [],
  now = new Date(),
  env = process.env,
  fetchFn = fetch,
}) {
  const model = String(env.AIRBNB_SUPPORT_OPENAI_MODEL ?? "gpt-5.6-sol");
  const effort = reasoningEffort(env);
  const verifiedFacts = facts && typeof facts === "object" ? facts : {};
  const knowledge = supportKnowledgeForListing({ listingName, propertyFacts: verifiedFacts });
  const evaluatedAt = latestEventAt ?? now;
  const stayPhase = supportStayPhase({ stayLabel, at: evaluatedAt, facts: verifiedFacts });
  const style = conversationStyle(guestMessage, guestName);
  const timePolicyDecision = supportTimeRequestDecision(guestMessage, verifiedFacts)
    ?? supportTimeFollowUpDecision(guestMessage, activeTimeRequest, now);
  const timePolicyVerified = timePolicyFactsVerified(timePolicyDecision, verifiedFacts, knowledge);

  const input = requestInput({
    now,
    latestEventAt,
    style,
    listingName,
    stayLabel,
    stayPhase,
    guestMessage,
    conversationContext,
    activeTimeRequest,
    timePolicyDecision: timePolicyVerified ? timePolicyDecision : null,
    knowledge,
    verifiedFacts,
  });
  let raw = await requestDecision({ model, effort, input, env, fetchFn });
  let draft = typeof raw.draft === "string" ? raw.draft.trim() : null;
  let wantsToSend = raw.replyNeeded === true && raw.sendReply === true && Boolean(draft);
  const initialQualityIssues = wantsToSend ? draftQualityIssues({ draft, stayPhase, style }) : [];
  let qualityRevisionCount = 0;
  if (initialQualityIssues.length) {
    qualityRevisionCount = 1;
    raw = await requestDecision({
      model,
      effort,
      input: { ...input, revisionFeedback: initialQualityIssues },
      env,
      fetchFn,
    });
    draft = typeof raw.draft === "string" ? raw.draft.trim() : null;
    wantsToSend = raw.replyNeeded === true && raw.sendReply === true && Boolean(draft);
  }
  const qualityIssues = wantsToSend ? draftQualityIssues({ draft, stayPhase, style }) : [];
  const sendReply = wantsToSend && qualityIssues.length === 0;
  const operationalRequest = sendReply
    && timePolicyVerified
    ? timePolicyDecision
    : null;

  return {
    topic: "adaptive_support",
    riskTier: sendReply ? "low" : "high",
    replyNeeded: raw.replyNeeded === true,
    summary: raw.summary,
    draft,
    decisionSource: "adaptive_agent",
    decisionVersion: 2,
    qualityRevisionCount,
    qualityIssues,
    operationalRequest,
    autoReply: sendReply,
    status: sendReply ? "approved_for_guard" : "needs_human",
    alertManagement: raw.alertManagement === true || (raw.replyNeeded === true && !sendReply),
    model,
    reasoningEffort: effort,
  };
}
