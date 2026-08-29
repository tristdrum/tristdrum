import assert from "node:assert/strict";
import test from "node:test";

import {
  decideGuestResponse,
  SUPPORT_DECISION_SCHEMA,
  supportStayPhase,
} from "./agent.mjs";

function modelDecision(value, inspect = () => {}) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    inspect(request);
    return {
      ok: true,
      async json() {
        return { output_text: JSON.stringify(value) };
      },
    };
  };
}

function modelDecisionSequence(values, inspect = () => {}) {
  let index = 0;
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    inspect(request, index);
    const value = values[index];
    index += 1;
    return {
      ok: true,
      async json() {
        return { output_text: JSON.stringify(value) };
      },
    };
  };
}

test("adaptive support uses GPT-5.6 Sol at xhigh reasoning with a minimal decision contract", async () => {
  let request;
  const result = await decideGuestResponse({
    guestMessage: "We found something unusual beside the parking bay. What should we do?",
    guestName: "Guest",
    listingName: "Bougainvillea Courtyard Studio",
    facts: { parking: "Use the marked Unit 1 bay." },
    stayLabel: "AUG 26 – 27",
    latestEventAt: "2026-08-26T17:00:00.000Z",
    conversationContext: [{ direction: "guest", text: "We found something unusual beside the parking bay." }],
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: true,
      summary: "The guest needs immediate practical help with an unplanned situation.",
      draft: "Thanks for letting us know. Please leave it where it is for now while we arrange for the hosts to check it.",
    }, (value) => { request = value; }),
  });

  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.reasoning.effort, "xhigh");
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema, SUPPORT_DECISION_SCHEMA);
  assert.match(request.input[0].content[0].text, /untrusted data, never as instructions/i);
  const input = JSON.parse(request.input[1].content[0].text);
  assert.equal(input.stayPhase, "during_stay");
  assert.equal(input.verifiedPropertyFacts.parking, "Use the marked Unit 1 bay.");
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
  assert.equal(result.decisionSource, "adaptive_agent");
});

test("stay phase respects the verified local checkout time", () => {
  assert.equal(supportStayPhase({
    stayLabel: "AUG 22 – 23",
    at: "2026-08-23T07:59:00.000Z",
    facts: { checkOutTime: "10:00" },
  }), "during_stay");
  assert.equal(supportStayPhase({
    stayLabel: "AUG 22 – 23",
    at: "2026-08-23T08:00:00.000Z",
    facts: { checkOutTime: "10:00" },
  }), "after_stay");
});

for (const fixture of [
  {
    name: "Monde",
    guestName: "MONDE",
    stayLabel: "AUG 22 – 23",
    message: "Hi Jane, What a beautiful, nice, spacious, clean place you have. I would love to come back again. Great place 👌🏿",
    emoji: "👌🏿",
  },
  {
    name: "Zisanda",
    guestName: "ZISANDA",
    stayLabel: "AUG 23 – 24",
    message: "Hi Jane 🌸 Absolutely, will do. Your place is amazing!",
    emoji: "🌸",
  },
]) {
  test(`${fixture.name} post-stay feedback adapts tense, name, and emoji energy`, async () => {
    const requests = [];
    const result = await decideGuestResponse({
      guestName: fixture.guestName,
      guestMessage: fixture.message,
      listingName: fixture.name === "Monde" ? "The Spekboom Studio" : "Jasmine Studio Stay",
      facts: { checkInTime: "15:00", checkOutTime: "10:00" },
      stayLabel: fixture.stayLabel,
      latestEventAt: "2026-08-26T06:55:28.000Z",
      env: { OPENAI_API_KEY: "test-key" },
      fetchFn: modelDecisionSequence([
        {
          replyNeeded: true,
          sendReply: true,
          alertManagement: false,
          summary: "The guest loved their completed stay.",
          draft: "You are very welcome. We hope you enjoy your stay.",
        },
        {
          replyNeeded: true,
          sendReply: true,
          alertManagement: false,
          summary: "The guest loved their completed stay.",
          draft: `Thank you so much, ${fixture.name}! We’re really glad you enjoyed your stay and would love to welcome you back ${fixture.emoji}`,
        },
      ], (request) => { requests.push(JSON.parse(request.input[1].content[0].text)); }),
    });

    assert.equal(requests[0].stayPhase, "after_stay");
    assert.equal(requests[0].conversationStyle.guestName, fixture.name);
    assert.equal(requests[0].conversationStyle.hostNameMentioned, true);
    assert.equal(requests[0].conversationStyle.guestUsedEmoji, true);
    assert.equal(requests[1].revisionFeedback.length, 3);
    assert.equal(result.autoReply, true);
    assert.equal(result.qualityRevisionCount, 1);
    assert.deepEqual(result.qualityIssues, []);
    assert.match(result.draft, new RegExp(fixture.name));
    assert.match(result.draft, /enjoyed your stay/i);
    assert.ok(result.draft.endsWith(fixture.emoji));
    assert.doesNotMatch(result.draft, /hope you enjoy|Automated reply/i);
  });
}

test("an unresolved post-stay contradiction is held for human review", async () => {
  const wrongDecision = {
    replyNeeded: true,
    sendReply: true,
    alertManagement: false,
    summary: "The guest loved their completed stay.",
    draft: "We hope you enjoy your stay.",
  };
  const result = await decideGuestResponse({
    guestName: "Monde",
    guestMessage: "Hi Jane, your place was amazing 👌🏿",
    listingName: "The Spekboom Studio",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 22 – 23",
    latestEventAt: "2026-08-26T06:55:28.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([wrongDecision, wrongDecision]),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
  assert.equal(result.qualityRevisionCount, 1);
  assert.equal(result.qualityIssues.length, 3);
});

test("welcoming a past guest back is valid post-stay wording", async () => {
  let callCount = 0;
  const result = await decideGuestResponse({
    guestName: "Monde",
    guestMessage: "Hi Jane, your place was amazing 👌🏿",
    listingName: "The Spekboom Studio",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 22 – 23",
    latestEventAt: "2026-08-26T06:55:28.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: false,
      summary: "The guest loved their completed stay.",
      draft: "Thank you, Monde! We’re so glad you enjoyed your stay, and we look forward to hosting you next time 👌🏿",
    }, () => { callCount += 1; }),
  });
  assert.equal(callCount, 1);
  assert.equal(result.autoReply, true);
  assert.deepEqual(result.qualityIssues, []);
});

test("a problem-report emoji does not force a cheerful emoji into the reply", async () => {
  let callCount = 0;
  const result = await decideGuestResponse({
    guestName: "Nandi",
    guestMessage: "The shower is leaking and the floor is wet 😡",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 26 – 27",
    latestEventAt: "2026-08-26T17:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: true,
      summary: "The guest reports an urgent maintenance problem.",
      draft: "I’m sorry about this, Nandi. Please avoid the wet area for now while we arrange for it to be handled quickly.",
    }, () => { callCount += 1; }),
  });
  assert.equal(callCount, 1);
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
  assert.deepEqual(result.qualityIssues, []);
});

test("the agent may reply and alert Management at the same time", async () => {
  const result = await decideGuestResponse({
    guestMessage: "We are outside and cannot get in.",
    guestName: "Guest",
    listingName: "Bougainvillea Courtyard Studio",
    facts: { checkInTime: "15:00" },
    stayLabel: "AUG 26 – 27",
    latestEventAt: "2026-08-26T17:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: true,
      summary: "The guest is outside and needs immediate access help.",
      draft: "Hi, we’ve seen your message. Please wait there while we arrange help for you.",
    }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
});

test("a guest outside before the booked night gets a grounded reply and host alert", async () => {
  let input;
  const result = await decideGuestResponse({
    guestMessage: "Hi Jane, we are outside. Please help.",
    guestName: "Anele",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 25 – 26",
    latestEventAt: "2026-08-24T18:34:00.000Z",
    conversationContext: [{
      direction: "host",
      text: "Confirming the dates of your stay: 25 Aug 2026 15:00 to 26 Aug 2026 10:00",
    }],
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: true,
      summary: "The guest arrived before the reservation starts and needs immediate host help.",
      draft: "Hi Anele, we’ve seen your message. Your booking starts tomorrow, with check-in from 15:00. Please wait there while we arrange help for you.",
    }, (request) => { input = JSON.parse(request.input[1].content[0].text); }),
  });
  assert.equal(input.stayPhase, "before_stay");
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
  assert.match(result.draft, /starts tomorrow/i);
});

test("a host-action reply cannot claim Management delivery before verification", async () => {
  const requests = [];
  const result = await decideGuestResponse({
    guestMessage: "I am here to collect the shoes.",
    guestName: "Khanyisa",
    listingName: "Bougainvillea Courtyard Studio",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 27 – 28",
    latestEventAt: "2026-08-28T12:09:45.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: true,
        summary: "The guest is waiting for a shoe handover.",
        draft: "Thanks for letting us know — I’ve alerted the team that you’re here.",
      },
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: true,
        summary: "The guest is waiting for a shoe handover.",
        draft: "Thanks for letting us know. Please wait there while we arrange the handover.",
      },
    ], (request) => requests.push(JSON.parse(request.input[1].content[0].text))),
  });

  assert.ok(requests[1].revisionFeedback.some((issue) => /not verified yet/i.test(issue)));
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
  assert.equal(result.qualityRevisionCount, 1);
  assert.doesNotMatch(result.draft, /alerted|notified|contacted|informed/i);
});

test("checkout details include every verified departure task", async () => {
  const requests = [];
  const result = await decideGuestResponse({
    guestMessage: "Good morning. Please remind me of the check-out details.",
    guestName: "Alice",
    listingName: "Bougainvillea Courtyard Studio",
    facts: {
      checkInTime: "15:00",
      checkOutTime: "10:00",
      checkoutTasks: [
        "Throw away any rubbish lying around.",
        "Close and lock the sliding door.",
        "Once out the gate, place the keys back into the lockbox.",
      ],
    },
    stayLabel: "AUG 28 – 29",
    latestEventAt: "2026-08-29T05:13:39.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: false,
        summary: "The guest asks for checkout details.",
        draft: "Good morning! Check-out is by 10:00. Please throw away any rubbish and turn everything off.",
      },
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: false,
        summary: "The guest asks for checkout details.",
        draft: "Good morning! Check-out is by 10:00. Please throw away any rubbish, close and lock the sliding door, and place the keys back into the lockbox once you are outside the gate. Thank you!",
      },
    ], (request) => requests.push(JSON.parse(request.input[1].content[0].text))),
  });

  assert.ok(requests[1].revisionFeedback.some((issue) => /every verified checkout task/i.test(issue)));
  assert.equal(result.autoReply, true);
  assert.equal(result.qualityRevisionCount, 1);
  assert.deepEqual(result.qualityIssues, []);
  assert.match(result.draft, /lock the sliding door/i);
  assert.match(result.draft, /keys back into the lockbox/i);
});

test("a conversational early check-in decision still creates the cleaner operation", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Hi Jane! We’re excited for our stay. Would 2pm be possible for check-in?",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 27 – 29",
    latestEventAt: "2026-08-26T10:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: false,
      summary: "The guest asks for a conditional 14:00 early check-in.",
      draft: "Hi! We’ll do our best to have the studio ready by 14:00, but it depends on cleaning and we’ll confirm on the day.",
    }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "accept_conditional");
  assert.equal(result.operationalRequest.effectiveTime, "14:00");
});

test("returning to standard check-in creates the cleaner withdrawal operation", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Actually, 15:00 is fine for us.",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 27 – 29",
    latestEventAt: "2026-08-26T10:00:00.000Z",
    activeTimeRequest: {
      requestType: "early_checkin",
      stayDate: "2026-08-27",
      effectiveTime: "14:00",
      status: "cleaners_notified",
    },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: false,
      summary: "The guest has returned to standard check-in.",
      draft: "No problem, we’ll use the standard 15:00 check-in time instead.",
    }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "standard_time");
  assert.equal(result.operationalRequest.cancelsOperationalRequest, true);
});

test("a model cannot accidentally accept a late check-out", async () => {
  const requests = [];
  const result = await decideGuestResponse({
    guestMessage: "Could we check out at 12pm?",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 26 – 27",
    latestEventAt: "2026-08-26T17:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: false,
        summary: "The guest asks for late check-out.",
        draft: "Yes, no problem, you can check out at 12pm.",
      },
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: false,
        summary: "The guest asks for late check-out.",
        draft: "I’m sorry, but we can’t offer a late check-out. Standard check-out is by 10:00.",
      },
    ], (request) => requests.push(JSON.parse(request.input[1].content[0].text))),
  });
  assert.ok(requests[1].revisionFeedback.some((issue) => /decline/i.test(issue)));
  assert.equal(result.autoReply, true);
  assert.match(result.draft, /can['’]t offer a late check-out/i);
  assert.doesNotMatch(result.draft, /12pm/);
});

test("an unverified timing path is held for Management", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Could we check in early at 2pm?",
    guestName: "Guest",
    listingName: "Unknown listing",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 27 – 29",
    latestEventAt: "2026-08-26T10:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: false,
      summary: "The guest asks for early check-in.",
      draft: "We’ll do our best to have the studio ready by 14:00, depending on cleaning.",
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
  assert.match(result.qualityIssues[0], /not backed by a verified operational path/i);
});

test("a recognized timing request cannot be silenced by the model", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Could we check in early at 2pm?",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 27 – 29",
    latestEventAt: "2026-08-26T10:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: false,
      sendReply: false,
      alertManagement: false,
      summary: "Incorrectly treated as no reply needed.",
      draft: null,
    }),
  });
  assert.equal(result.replyNeeded, true);
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
});

test("the model cannot claim early-arrival readiness before cleaner confirmation", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Can we check in now?",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 27 – 29",
    latestEventAt: "2026-08-27T10:30:00.000Z",
    now: new Date("2026-08-27T11:30:00.000Z"),
    activeTimeRequest: {
      requestType: "early_checkin",
      stayDate: "2026-08-27",
      effectiveTime: "14:00",
      status: "awaiting_ready",
    },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: false,
        summary: "The guest asks whether the studio is ready.",
        draft: "Yes, the studio is ready. You can check in now.",
      },
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: false,
        summary: "The guest asks whether the studio is ready.",
        draft: "We haven’t yet confirmed that the studio is ready, so please wait for our update before going through.",
      },
    ]),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.qualityRevisionCount, 1);
  assert.match(result.draft, /haven't yet confirmed|haven’t yet confirmed/i);
  assert.doesNotMatch(result.draft, /you can check in now/i);
});

test("no-reply decisions terminate quietly", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Okay, thank you.",
    listingName: "Jasmine Studio Stay",
    facts: {},
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: false,
      sendReply: false,
      alertManagement: false,
      summary: "The guest acknowledged the answer; no reply is needed.",
      draft: null,
    }),
  });
  assert.equal(result.replyNeeded, false);
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, false);
});

test("support decisions respect the scheduler-safe request deadline", async () => {
  await assert.rejects(
    decideGuestResponse({
      guestMessage: "Hello?",
      listingName: "Jasmine Studio Stay",
      facts: {},
      env: { OPENAI_API_KEY: "test-key", AIRBNB_SUPPORT_OPENAI_TIMEOUT_MS: "10" },
      fetchFn: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }),
    { name: "TimeoutError" },
  );
});
