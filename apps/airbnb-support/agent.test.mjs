import assert from "node:assert/strict";
import test from "node:test";

import {
  decideGuestResponse,
  SUPPORT_DECISION_SCHEMA,
  SUPPORT_DECISION_VERSION,
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

const selfServiceInput = {
  guestName: "Guest",
  listingName: "Jasmine Studio Stay",
  stayLabel: "Sep 22 - 24, 2026",
  latestEventAt: "2026-09-22T10:00:00Z",
  now: new Date("2026-09-22T10:05:00Z"),
  facts: { checkInTime: "15:00", checkOutTime: "10:00", earliestCheckInTime: "13:00" },
  env: { OPENAI_API_KEY: "test-key" },
};

const selfServiceDecision = {
  replyNeeded: true, sendReply: true, alertManagement: false,
  summary: "Routine self-service timing.", managementSummary: null,
  officeStorageArrangement: null,
};

for (const fixture of [
  { name: "Marcus 16:20", guestName: "Marcus", guestMessage: "We will arrive around 16:20.",
    roomTimingRequest: "The guest expects to arrive around 16:20.", draft: "That works, Marcus. You can use self check-in when you arrive." },
  { name: "Leon after 17", guestName: "Leon", guestMessage: "We will only arrive after 17.",
    roomTimingRequest: "The guest will arrive after 17.", draft: "No problem, Leon. You can use self check-in when you arrive." },
  { name: "David shortly after 3pm tomorrow", guestName: "David", guestMessage: "We will arrive shortly after 3pm tomorrow.",
    stayLabel: "Sep 23 - 24, 2026", bookedStay: { checkIn: "2026-09-23", checkOut: "2026-09-24" },
    roomTimingRequest: "The guest will arrive shortly after 3pm on 2026-09-23.",
    draft: "That works, David. You can use self check-in when you arrive tomorrow." },
  { name: "late without a clock", guestMessage: "Our flight is delayed so we will arrive late.",
    roomTimingRequest: "Late check-in on 2026-09-22, time unspecified.", draft: "A late arrival is fine. You can use self check-in." },
  { name: "after midnight in the booked night", guestMessage: "Can we check in at 1am on the 23rd?",
    roomTimingRequest: "Check-in on 2026-09-23 at 01:00.", draft: "Yes, that is within your booked night. You can use self check-in." },
  { name: "midnight on the checkout date", guestMessage: "We will arrive at midnight on the 24th.",
    roomTimingRequest: "Check-in on 2026-09-24 at 00:00.", draft: "You can use self check-in then. Your checkout is still by 10:00 that morning." },
  { name: "early departure", guestMessage: "We will leave at 5am on the 24th.",
    roomTimingRequest: "Early check-out on 2026-09-24 at 05:00.", draft: "That is fine. Please follow the usual self checkout instructions." },
  { name: "early departure without a clock", guestMessage: "We are leaving early on the 24th.",
    roomTimingRequest: "Early check-out on 2026-09-24, time unspecified.", draft: "An early departure is fine. Please follow the usual self checkout instructions." },
  { name: "departure one day early at 17:00", guestMessage: "We are leaving at 5pm on the 23rd instead.",
    roomTimingRequest: "Check-out on 2026-09-23 at 17:00.", draft: "Leaving then is fine. Please follow the usual self checkout instructions." },
  { name: "checkout at the boundary", guestMessage: "We will check out at 10am on the 24th.",
    roomTimingRequest: "Check-out on 2026-09-24 at 10:00.", draft: "That works. Thank you for staying with us." },
]) {
  test(`${fixture.name} is a quiet self-service decision in one call`, async () => {
    let calls = 0;
    const result = await decideGuestResponse({
      ...selfServiceInput, ...fixture,
      fetchFn: modelDecision({ ...selfServiceDecision, roomTimingRequest: fixture.roomTimingRequest, draft: fixture.draft }, (request) => {
        calls += 1;
        const input = JSON.parse(request.input[1].content[0].text);
        assert.deepEqual(input.bookedStay, fixture.bookedStay ?? { checkIn: "2026-09-22", checkOut: "2026-09-24" });
        assert.match(request.input[0].content[0].text, /Routine self check-in and self checkout/);
        assert.match(request.input[0].content[0].text, /After-midnight arrival on the night already booked/);
      }),
    });
    assert.equal(calls, 1);
    assert.equal(result.autoReply, true);
    assert.equal(result.alertManagement, false);
    assert.equal(result.operationalRequest, null);
    assert.equal(result.bagDropRequest, null);
    assert.doesNotMatch(result.draft, /you(?:'ve| have| already) (?:arrived|checked in)|glad you arrived/i);
    assert.deepEqual(result.qualityIssues, []);
    assert.equal(result.decisionVersion, SUPPORT_DECISION_VERSION);
  });
}

test("routine ETA and completed checkout can be acknowledged without forcing a reply or alert", async () => {
  for (const fixture of [
    { guestMessage: "Thanks, still arriving at 16:20.", roomTimingRequest: "Check-in on 2026-09-22 at 16:20." },
    { guestMessage: "Thanks, we checked out at 8am.", roomTimingRequest: "Check-out on 2026-09-24 at 08:00.",
      latestEventAt: "2026-09-24T09:00:00Z" },
  ]) {
    const result = await decideGuestResponse({
      ...selfServiceInput, ...fixture,
      fetchFn: modelDecision({ ...selfServiceDecision, roomTimingRequest: fixture.roomTimingRequest,
        replyNeeded: false, sendReply: false, draft: null }),
    });
    assert.equal(result.replyNeeded, false);
    assert.equal(result.autoReply, false);
    assert.equal(result.alertManagement, false);
    assert.equal(result.operationalRequest, null);
  }
});

test("midnight before booked access keeps the 13:00 conditional earliest-entry policy", async () => {
  const result = await decideGuestResponse({
    ...selfServiceInput, guestMessage: "Can we check in at 1am on the 22nd?",
    fetchFn: modelDecision({ ...selfServiceDecision,
      roomTimingRequest: "Check-in on 2026-09-22 at 01:00.",
      draft: "The earliest we can offer is 13:00 on the 22nd, subject to cleaning. Would that work?" }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "offer_earliest");
  assert.equal(result.operationalRequest.effectiveTime, "13:00");
  assert.equal(result.operationalRequest.createsOperationalRequest, false);
});

test("an ambiguous midnight date is clarified in one call, not treated as guaranteed entry", async () => {
  let calls = 0;
  const result = await decideGuestResponse({
    ...selfServiceInput, guestMessage: "Can we arrive after midnight?",
    fetchFn: modelDecision({ ...selfServiceDecision, roomTimingRequest: "Check-in after midnight, date unspecified.",
      draft: "Which date will you arrive? I want to make sure that is within your booked night." }, () => { calls += 1; }),
  });
  assert.equal(calls, 1);
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, false);
  assert.equal(result.operationalRequest.action, "clarify_date");
  assert.equal(result.operationalRequest.createsOperationalRequest, false);
});

test("out-of-stay dates and unverified timing facts cannot grant self-service access", async () => {
  for (const fixture of [
    { roomTimingRequest: "Check-in on 2026-09-21 at 16:20." },
    { roomTimingRequest: "Check-in on 2026-09-24 at 16:20." },
    { roomTimingRequest: "Check-in on 2026-09-25 at 01:00." },
    { roomTimingRequest: "Check-in on 2026-09-22 at 16:20.", listingName: "Unknown listing" },
    { roomTimingRequest: "Check-in on 2026-09-22 at 16:20.", facts: {} },
    { roomTimingRequest: "Check-in on 2026-09-22 at 16:20.", facts: { checkInTime: "14:00", checkOutTime: "10:00" } },
  ]) {
    const result = await decideGuestResponse({
      ...selfServiceInput, ...fixture, guestMessage: "Is that arrival okay?",
      fetchFn: modelDecision({ ...selfServiceDecision, roomTimingRequest: fixture.roomTimingRequest,
        draft: "You can use self check-in then." }),
    });
    assert.equal(result.autoReply, false);
    assert.equal(result.alertManagement, true);
    assert.equal(result.operationalRequest, null);
  }
});

test("routine late ETA does not suppress a mixed lockout or missing access issue", async () => {
  for (const issue of ["the lockbox will not open", "I do not have the access details"]) {
    const naturalSummary = `Marcus is staying 22-24 September and arriving after 17:00, but ${issue}. He needs help getting into the studio.`;
    let calls = 0;
    const result = await decideGuestResponse({
      ...selfServiceInput, guestName: "Marcus", guestMessage: `I am arriving after 17:00, but ${issue}.`,
      priorManagementAlerts: [{ summary: naturalSummary, notifiedAt: "2026-09-22T09:55:00Z", resolvedAt: null, stage: "immediate" }],
      fetchFn: modelDecision({ ...selfServiceDecision, alertManagement: true, managementSummary: naturalSummary,
        roomTimingRequest: "Check-in on 2026-09-22 after 17:00.",
        draft: "Arriving then is fine. I am sorry about the access trouble; that needs checking." }, () => { calls += 1; }),
    });
    assert.equal(calls, 1);
    assert.equal(result.autoReply, true);
    assert.equal(result.alertManagement, true);
    assert.equal(result.managementSummary, naturalSummary);
    assert.equal(result.operationalRequest, null);
  }
});

test("prior delivered summaries let the single full-context decision keep unchanged follow-ups quiet", async () => {
  const priorManagementAlerts = [{
    summary: "Leon is staying 22-24 September and cannot open the lockbox. He needs help gaining access.",
    notifiedAt: "2026-09-22T15:10:00Z", resolvedAt: null, stage: "immediate",
  }, {
    summary: "Leon needed directions to the studio for his stay on 22-24 September.",
    notifiedAt: "2026-09-22T10:10:00Z", resolvedAt: "2026-09-22T10:15:00Z", stage: "immediate",
  }];
  for (const [guestMessage, changed] of [["Thank you, I will wait.", false], ["Still the same issue, thanks for checking.", false],
    ["The suggested fix failed and we are still locked out with our children.", true]]) {
    let calls = 0;
    const result = await decideGuestResponse({
      ...selfServiceInput, guestName: "Leon", guestMessage, priorManagementAlerts,
      latestEventAt: "2026-09-22T15:15:00Z", now: new Date("2026-09-22T15:16:00Z"),
      conversationContext: [{ direction: "guest", text: "I cannot open the lockbox." }],
      fetchFn: modelDecision({ replyNeeded: changed, sendReply: changed, alertManagement: changed,
        summary: changed ? "Failed assistance needs renewed attention." : "Already alerted; no new action.",
        managementSummary: changed ? "Leon is staying 22-24 September and remains locked out after trying the suggested fix. He is waiting outside with his children and needs help now." : null,
        roomTimingRequest: null, officeStorageArrangement: null,
        draft: changed ? "I am sorry that did not work. You still need help getting in." : null }, (request) => {
        calls += 1;
        assert.deepEqual(JSON.parse(request.input[1].content[0].text).priorManagementAlerts, priorManagementAlerts);
        assert.match(request.input[0].content[0].text, /unchanged follow-ups about an already-alerted issue/);
        assert.match(request.input[0].content[0].text, /failed help, or new action needed/);
      }),
    });
    assert.equal(calls, 1);
    assert.equal(result.alertManagement, changed);
    assert.equal(result.replyNeeded, changed);
    assert.equal(result.managementSummary !== null, changed);
  }
});

test("managementSummary is nullable and backward compatible, with no links, labels, or credentials", async () => {
  assert.deepEqual(SUPPORT_DECISION_SCHEMA.properties.managementSummary, { type: ["string", "null"], maxLength: 800 });
  assert.ok(SUPPORT_DECISION_SCHEMA.required.includes("managementSummary"));
  for (const managementSummary of [undefined, null, "", "x".repeat(801), "Summary: Guest needs help.",
    "Guest needs help. The door is broken. Please repair it.", "Guest needs help: airbnb.com/hosting/thread/123",
    "Guest needs help.\nThe door is broken.", "Guest needs help: https://example.com/hosting/thread/123",
    "The Wi-Fi password is fixture-secret.", "The lockbox does not accept 4827.", "The door PIN: 9326 fails.", "The door code 9326 fails."]) {
    const result = await decideGuestResponse({
      ...selfServiceInput, guestMessage: "The door is broken.",
      facts: { ...selfServiceInput.facts, wifiPassword: "fixture-secret", accessInstructions: "Use code 4827." },
      fetchFn: modelDecision({ replyNeeded: true, sendReply: false, alertManagement: true,
        summary: "The guest needs help.", managementSummary, draft: null }),
    });
    assert.equal(result.managementSummary, null);
    assert.equal(result.alertManagement, true);
  }
});

test("dated stay context honors explicit years and rejects impossible ranges", async () => {
  for (const [stayLabel, bookedStay] of [
    ["Sep 22 - 24, 2027", { checkIn: "2027-09-22", checkOut: "2027-09-24" }],
    ["Dec 31 - Jan 2, 2026", { checkIn: "2026-12-31", checkOut: "2027-01-02" }],
    ["Sep 31 - Oct 2, 2026", null],
    ["Sep 24 - 22, 2026", null],
  ]) {
    await decideGuestResponse({
      ...selfServiceInput, stayLabel, guestMessage: "Thank you.",
      fetchFn: modelDecision({ ...selfServiceDecision, replyNeeded: false, sendReply: false, draft: null,
        roomTimingRequest: null }, (request) => {
        assert.deepEqual(JSON.parse(request.input[1].content[0].text).bookedStay, bookedStay);
      }),
    });
  }
});

test("accepting a host counteroffer creates the accepted room-timing operation, independently of office policy", async () => {
  for (const officeAllowed of [false, true]) {
    const context = [
      { direction: "guest", text: "Could I check in at 11:00 or 12:00 tomorrow?" },
      { direction: "host", text: "The earliest possible early check-in is 13:00, subject to cleaning. Would 13:00 work?" },
      { direction: "guest", text: "Thank you, I am willing to take that." },
    ];
    let calls = 0;
    const result = await decideGuestResponse({
      guestMessage: context[2].text,
      guestName: "Guest",
      listingName: "Jasmine Studio Stay",
      facts: { checkInTime: "15:00", checkOutTime: "10:00", earliestCheckInTime: "13:00",
        ...(officeAllowed ? { officeLuggageStorage: { allowed: true, location: "Office" } } : {}) },
      stayLabel: "Sep 13 - 15, 2026",
      latestEventAt: "2026-09-12T09:28:00Z",
      now: new Date("2026-09-12T09:35:00Z"),
      conversationContext: context,
      env: { OPENAI_API_KEY: "test-key" },
      fetchFn: modelDecision({
        replyNeeded: true, sendReply: true, alertManagement: false,
        summary: "Guest accepted the host's conditional 13:00 offer.",
        draft: "We will aim for 13:00 tomorrow, subject to the cleaning team confirming the studio is ready.",
        officeStorageArrangement: null,
        roomTimingRequest: "The guest accepts early check-in at 13:00 tomorrow, subject to cleaning readiness.",
      }, (request) => {
        calls += 1;
        assert.match(request.input[0].content[0].text, /accepts a host's timing offer/);
        assert.deepEqual(JSON.parse(request.input[1].content[0].text).recentConversation, context);
      }),
    });
    assert.equal(calls, 1);
    assert.equal(result.autoReply, true);
    assert.equal(result.operationalRequest.action, "accept_conditional");
    assert.equal(result.operationalRequest.effectiveTime, "13:00");
    assert.equal(result.operationalRequest.createsOperationalRequest, true);
    assert.deepEqual(result.qualityIssues, []);
  }
});

test("courtesy after an unchanged active early-arrival arrangement creates no new operation", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Thank you!",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00", earliestCheckInTime: "13:00" },
    stayLabel: "Sep 13 - 15, 2026",
    latestEventAt: "2026-09-12T09:28:00Z",
    now: new Date("2026-09-12T09:35:00Z"),
    activeTimeRequest: { requestType: "early_checkin", effectiveTime: "13:00", status: "cleaners_notified", stayDate: "2026-09-13" },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: false, sendReply: false, alertManagement: false,
      summary: "Courtesy after an already recorded arrangement.", draft: null,
      officeStorageArrangement: null, roomTimingRequest: null,
    }),
  });
  assert.equal(result.replyNeeded, false);
  assert.equal(result.autoReply, false);
  assert.equal(result.operationalRequest, null);
});

test("an unparseable room paraphrase cannot erase the original late-checkout guard", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Could we check out at 12pm?",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00", earliestCheckInTime: "13:00" },
    stayLabel: "Sep 11 - 12, 2026",
    latestEventAt: "2026-09-12T07:00:00Z",
    now: new Date("2026-09-12T07:01:00Z"),
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Checkout request.", draft: "Yes, no problem, you can check out at 12:00.",
      officeStorageArrangement: null,
      roomTimingRequest: "The guest requests checkout at 12:00.",
    }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
  assert.equal(result.operationalRequest, null);
  assert.ok(result.qualityIssues.some((issue) => /decline|accepted/i.test(issue)));
});

test("an unparseable contextual room request is held even if the model asks to stay silent", async () => {
  const result = await decideGuestResponse({
    guestMessage: "That works for me.",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "Sep 13 - 15, 2026",
    latestEventAt: "2026-09-12T09:28:00Z",
    now: new Date("2026-09-12T09:35:00Z"),
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: false, sendReply: false, alertManagement: false,
      summary: "Contextual acceptance.", draft: null,
      officeStorageArrangement: null, roomTimingRequest: "Guest accepts the previously offered arrangement.",
    }),
  });
  assert.equal(result.replyNeeded, true);
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
  assert.equal(result.operationalRequest, null);
});

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
  assert.match(request.input[0].content[0].text, /distinguish luggage storage from room entry/i);
  const input = JSON.parse(request.input[1].content[0].text);
  assert.equal(input.stayPhase, "during_stay");
  assert.equal(input.verifiedPropertyFacts.parking, "Use the marked Unit 1 bay.");
  assert.deepEqual(input.canonicalKnowledge.sharedFacts.bagDrop, {
    allowedAfter: "The previous guest has actually checked out.",
    usualFromTime: "10:00",
    delayedByLateDeparture: true,
    grantsRoomAccess: false,
  });
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

test("missing reply routes are in the same decision context so host summaries explain the real action", async () => {
  const managementSummary = "Alex, asking about 23-25 September, needs the studio location confirmed; reply in Airbnb because email replies are unavailable.";
  const result = await decideGuestResponse({guestMessage: "Where is the studio?",guestName:"Alex",
    listingName:"Jasmine Studio Stay",stayLabel:"Sep 23 - 25, 2026",replyRouteAvailable:false,
    env:{OPENAI_API_KEY:"test-key"},fetchFn:modelDecision({replyNeeded:true,sendReply:false,
      alertManagement:true,summary:"Location question needs an Airbnb reply.",managementSummary,
      draft:"We are in Nahoon, East London.",roomTimingRequest:null,officeStorageArrangement:null},request=>{
        assert.equal(JSON.parse(request.input[1].content[0].text).replyRouteAvailable,false);
      })});
  assert.equal(result.managementSummary,managementSummary);
  assert.equal(result.autoReply,false);
  assert.equal(result.alertManagement,true);
});

test("an extension question can receive verified listing links while the host decision remains unresolved", async () => {
  let captured;
  const draft = "You can check your dates here: https://www.airbnb.com/h/jasmine-studio-stay. Your current reservation has not been extended; that still needs confirmation.";
  const result = await decideGuestResponse({
    guestMessage: "Could I extend my stay for one more night?",
    guestName: "Guest",
    listingName: "Jasmine Studio Stay",
    stayLabel: "Sep 13 - 15, 2026",
    latestEventAt: "2026-09-14T19:06:55Z",
    now: new Date("2026-09-14T19:10:00Z"),
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true, sendReply: true, alertManagement: true,
      summary: "Guest can check public availability; extension remains a host decision.",
      draft, officeStorageArrangement: null, roomTimingRequest: null,
    }, (request) => { captured = request; }),
  });
  const input = JSON.parse(captured.input[1].content[0].text);
  assert.equal(input.canonicalKnowledge.property.publicListingUrl, "https://www.airbnb.com/h/jasmine-studio-stay");
  assert.equal(input.canonicalKnowledge.knownProperties.length, 3);
  assert.match(captured.input[0].content[0].text, /verified public listing links may still help/);
  assert.match(captured.input[0].content[0].text, /never host-only links/);
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
  assert.equal(result.draft, draft);
  assert.equal(result.operationalRequest, null);
  assert.deepEqual(result.qualityIssues, []);
});

test("fresh exact Airbnb UI facts can answer booking and availability without changing the model or alert path", async () => {
  const observedAt = "2026-09-24T10:04:00.000Z";
  const stay = { listingName: "Jasmine Studio Stay", checkIn: "2026-10-05", checkOut: "2026-10-07" };
  const liveWebsiteFacts = {
    source: "airbnb_ui", providerThreadId: "airbnb-thread-1", observedAt, requestedStay: stay,
    reservation: { ...stay, status: "confirmed", verified: true, complete: true },
    calendar: { ...stay, status: "available", verified: true, complete: true },
  };
  const result = await decideGuestResponse({
    guestMessage: "Is my booking confirmed for 5-7 October, and is Jasmine available then?",
    guestName: "Guest", providerThreadId: "airbnb-thread-1", listingName: stay.listingName,
    now: new Date("2026-09-24T10:05:00.000Z"), liveWebsiteFacts,
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Verified booking and calendar answer.", managementSummary: null,
      draft: "Your Jasmine Studio Stay booking for 5-7 October is confirmed. The calendar also shows those dates as available, but that does not create another booking.",
      roomTimingRequest: null, officeStorageArrangement: null,
    }, (request) => {
      const input = JSON.parse(request.input[1].content[0].text);
      assert.equal(request.model, "gpt-5.6-sol");
      assert.equal(request.reasoning.effort, "xhigh");
      assert.equal(input.liveWebsiteFacts.freshness, "fresh");
      assert.deepEqual(input.liveWebsiteFacts.reservation, liveWebsiteFacts.reservation);
      assert.deepEqual(input.liveWebsiteFacts.calendar, liveWebsiteFacts.calendar);
      assert.match(request.input[0].content[0].text, /A calendar opening is not a confirmed booking/);
    }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, false);
  assert.deepEqual(result.qualityIssues, []);
});

test("partial or stale UI facts cannot authorize a booking or vacancy claim", async () => {
  const stay = { listingName: "Jasmine Studio Stay", checkIn: "2026-10-05", checkOut: "2026-10-07" };
  for (const liveWebsiteFacts of [
    { source: "airbnb_ui", providerThreadId: "airbnb-thread-1", observedAt: "2026-09-24T09:59:00.000Z",
      reservation: { ...stay, status: "confirmed", verified: true, complete: true } },
    { source: "airbnb_ui", providerThreadId: "airbnb-thread-1", observedAt: "2026-09-24T10:04:00.000Z", requestedStay: stay,
      reservation: { ...stay, status: "confirmed", verified: false, complete: true },
      calendar: { ...stay, status: "available", verified: true, complete: false } },
  ]) {
    let calls = 0;
    const unsafe = {
      replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Unsupported answer.", managementSummary: null,
      draft: "Your booking is confirmed and Jasmine is available for those dates.",
      roomTimingRequest: null, officeStorageArrangement: null,
    };
    const result = await decideGuestResponse({
      guestMessage: "Is my booking confirmed and is Jasmine available?",
      providerThreadId: "airbnb-thread-1", listingName: stay.listingName,
      now: new Date("2026-09-24T10:05:00.000Z"),
      liveWebsiteFacts, env: { OPENAI_API_KEY: "test-key" },
      fetchFn: modelDecisionSequence([unsafe, unsafe], (request, index) => {
        calls += 1;
        const input = JSON.parse(request.input[1].content[0].text);
        assert.equal(input.liveWebsiteFacts, null);
        if (index === 1) assert.ok(input.revisionFeedback.length >= 2);
      }),
    });
    assert.equal(calls, 2);
    assert.equal(result.autoReply, false);
    assert.equal(result.alertManagement, true);
    assert.ok(result.qualityIssues.some((issue) => /booking status/.test(issue)));
    assert.ok(result.qualityIssues.some((issue) => /availability/.test(issue)));
  }
});

test("a wrong UI status is revised; an unresolved real question can be acknowledged and alerted", async () => {
  const stay = { listingName: "Jasmine Studio Stay", checkIn: "2026-10-05", checkOut: "2026-10-07" };
  const pending = await decideGuestResponse({
    guestMessage: "Is the booking confirmed?", providerThreadId: "airbnb-thread-1", listingName: stay.listingName,
    now: new Date("2026-09-24T10:05:00.000Z"),
    liveWebsiteFacts: { source: "airbnb_ui", providerThreadId: "airbnb-thread-1",
      observedAt: "2026-09-24T10:04:00.000Z",
      reservation: { ...stay, status: "pending", verified: true, complete: true } },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      { replyNeeded: true, sendReply: true, alertManagement: false, summary: "Status answer.",
        draft: "Your booking is confirmed.", roomTimingRequest: null, officeStorageArrangement: null },
      { replyNeeded: true, sendReply: true, alertManagement: false, summary: "Status answer.",
        draft: "The Jasmine Studio Stay request for 5-7 October is pending, not confirmed yet.",
        roomTimingRequest: null, officeStorageArrangement: null },
    ]),
  });
  assert.equal(pending.autoReply, true);
  assert.equal(pending.qualityRevisionCount, 1);

  const uncertain = await decideGuestResponse({
    guestMessage: "Is Jasmine available for 5-7 October?", listingName: stay.listingName,
    now: new Date("2026-09-24T10:05:00.000Z"), env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({ replyNeeded: true, sendReply: true, alertManagement: true,
      summary: "Availability needs a current check.",
      managementSummary: "A guest asks whether Jasmine is available for 5-7 October; the calendar needs checking before anyone can answer.",
      draft: "I'll double-check the calendar for 5-7 October and get back to you.",
      roomTimingRequest: null, officeStorageArrangement: null }),
  });
  assert.equal(uncertain.autoReply, true);
  assert.equal(uncertain.alertManagement, true);
  assert.ok(uncertain.managementSummary);

  const courtesy = await decideGuestResponse({
    guestMessage: "Thanks, I'll wait.", listingName: stay.listingName,
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({ replyNeeded: false, sendReply: false, alertManagement: false,
      summary: "No new need.", managementSummary: null, draft: null,
      roomTimingRequest: null, officeStorageArrangement: null }),
  });
  assert.equal(courtesy.replyNeeded, false);
  assert.equal(courtesy.alertManagement, false);
});

test("a promise to check cannot mask an unsupported availability assertion later in the draft", async () => {
  const unsafe = {
    replyNeeded: true, sendReply: true, alertManagement: false,
    summary: "Unverified availability.", managementSummary: null,
    draft: "I'll check whether Jasmine is available. Jasmine is available now.",
    roomTimingRequest: null, officeStorageArrangement: null,
  };
  const result = await decideGuestResponse({
    guestMessage: "Is Jasmine available?", listingName: "Jasmine Studio Stay",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([unsafe, unsafe]),
  });
  assert.equal(result.autoReply, false);
  assert.ok(result.qualityIssues.some((issue) => /availability/.test(issue)));
});

test("live UI claims with another studio, wrong dates, or unsupported availability are held", async () => {
  const stay = { listingName: "Jasmine Studio Stay", checkIn: "2026-10-05", checkOut: "2026-10-07" };
  const liveWebsiteFacts = {
    source: "airbnb_ui", providerThreadId: "airbnb-thread-1",
    observedAt: "2026-09-24T10:04:00.000Z", requestedStay: stay,
    reservation: { ...stay, status: "confirmed", verified: true, complete: true },
    calendar: { ...stay, status: "available", verified: true, complete: true },
  };
  for (const [draft, expected] of [
    ["Your Spekboom booking for 5-7 October is confirmed.", /reservation listing/],
    ["Your Jasmine booking for 5-8 October is confirmed.", /reservation listing/],
    ["Jasmine Studio Stay is for 5-7 October. Your Jasmine booking for 5-8 October is confirmed.", /reservation listing/],
    ["We have availability for Jasmine on 5-8 October.", /calendar listing/],
  ]) {
    const raw = { replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Unsupported claim.", managementSummary: null, draft,
      roomTimingRequest: null, officeStorageArrangement: null };
    const result = await decideGuestResponse({
      guestMessage: "Is my booking confirmed, and are those dates available?",
      providerThreadId: "airbnb-thread-1", listingName: stay.listingName,
      now: new Date("2026-09-24T10:05:00.000Z"), liveWebsiteFacts,
      env: { OPENAI_API_KEY: "test-key" },
      fetchFn: modelDecisionSequence([raw, raw]),
    });
    assert.equal(result.autoReply, false, draft);
    assert.ok(result.qualityIssues.some((issue) => expected.test(issue)), draft);
  }
  const unsupported = await decideGuestResponse({
    guestMessage: "Is Jasmine available?", listingName: stay.listingName,
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([{
      replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Unverified vacancy.", managementSummary: null,
      draft: "We have availability.", roomTimingRequest: null, officeStorageArrangement: null,
    }, {
      replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Unverified vacancy.", managementSummary: null,
      draft: "We have availability.", roomTimingRequest: null, officeStorageArrangement: null,
    }]),
  });
  assert.equal(unsupported.autoReply, false);
  assert.ok(unsupported.qualityIssues.some((issue) => /availability/.test(issue)));
});

test("a grounded revision clears the first-pass Management alert and summary", async () => {
  const stay = { listingName: "Jasmine Studio Stay", checkIn: "2026-10-05", checkOut: "2026-10-07" };
  const result = await decideGuestResponse({
    guestMessage: "Is my booking confirmed?", providerThreadId: "airbnb-thread-1",
    listingName: stay.listingName, now: new Date("2026-09-24T10:05:00.000Z"),
    liveWebsiteFacts: { source: "airbnb_ui", providerThreadId: "airbnb-thread-1",
      observedAt: "2026-09-24T10:04:00.000Z",
      reservation: { ...stay, status: "confirmed", verified: true, complete: true } },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      { replyNeeded: true, sendReply: true, alertManagement: true,
        summary: "Check the booking.", managementSummary: "A booking needs Management review.",
        draft: "Your booking is confirmed.", roomTimingRequest: null, officeStorageArrangement: null },
      { replyNeeded: true, sendReply: true, alertManagement: false,
        summary: "The current UI answers the question.",
        managementSummary: "Stale first-pass summary must be ignored.",
        draft: "Your Jasmine Studio Stay booking for 5-7 October is confirmed.",
        roomTimingRequest: null, officeStorageArrangement: null },
    ]),
  });
  assert.equal(result.qualityRevisionCount, 1);
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, false);
  assert.equal(result.managementSummary, null);
});

test("post-stay collection does not become a new check-in permission", async () => {
  let input;
  const result = await decideGuestResponse({
    guestMessage: "Could I arrive at 4:15 pm?",
    guestName: "Guest",
    listingName: "Bougainvillea Courtyard Studio",
    facts: { checkInTime: "15:00", checkOutTime: "10:00", lostPropertyCollection: "Collection requires a confirmed office handoff." },
    stayLabel: "SEP 2 - 3",
    latestEventAt: "2026-09-04T08:38:54Z",
    now: new Date("2026-09-04T08:40:00Z"),
    conversationContext: [{ direction: "host", text: "Your item is in the office; please arrange collection." }],
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({ replyNeeded: true, sendReply: false, alertManagement: true,
      summary: "Office availability must be confirmed.", draft: null }, (request) => {
      input = JSON.parse(request.input[1].content[0].text);
    }),
  });
  assert.equal(input.stayPhase, "after_stay");
  assert.equal(input.timePolicyDecision, null);
  assert.equal(result.autoReply, false);
  assert.equal(result.operationalRequest, null);
});

test("verified Wi-Fi details remain eligible for an ordinary in-stay reply", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Please send the Wi-Fi details.", guestName: "Guest",
    listingName: "Jasmine Studio Stay", stayLabel: "SEP 11 - 12",
    latestEventAt: "2026-09-11T14:00:00Z",
    facts: { wifiNetwork: "Fixture network", wifiPassword: "fixture-only", checkInTime: "15:00", checkOutTime: "10:00" },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({ replyNeeded: true, sendReply: true, alertManagement: false,
      summary: "Provide verified Wi-Fi details.", draft: "Of course! The network is Fixture network and the password is fixture-only." }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, false);
});

test("office permission cannot erase an explicit room checkout restriction", async () => {
  const result = await decideGuestResponse({
    guestMessage: "Can I check out at 11am?", guestName: "Guest",
    listingName: "Jasmine Studio Stay", stayLabel: "SEP 11 - 12",
    latestEventAt: "2026-09-12T06:00:00Z",
    facts: { checkInTime: "15:00", checkOutTime: "10:00", officeLuggageStorage: { allowed: true, location: "Office by the car park, through the glass doors" } },
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({ replyNeeded: true, sendReply: true, alertManagement: false,
      roomTimingRequest: null, officeStorageArrangement: null,
      summary: "The guest asks about checkout.", draft: "Yes, checking out at 11:00 is fine." }),
  });
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
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

test("general post-stay improvement feedback is eligible for a warm automatic acknowledgement", async () => {
  let input;
  const result = await decideGuestResponse({
    guestMessage: "Thank you for the stay. I have submitted some improvement feedback and left a review.",
    guestName: "GUEST",
    listingName: "The Spekboom Studio",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "AUG 29 - 30",
    latestEventAt: "2026-08-31T09:06:47.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: false,
      summary: "The past guest submitted general improvement feedback without naming an actionable issue.",
      draft: "Thank you so much for taking the time to share your feedback and leave a review. We really appreciate it and will take everything on board. We are sorry for anything that was not up to scratch, and we will learn from it and make it right next time.",
    }, (request) => { input = JSON.parse(request.input[1].content[0].text); }),
  });

  assert.equal(input.stayPhase, "after_stay");
  assert.equal(input.canonicalKnowledge.approvedResponsePatterns.generalPostStayImprovementFeedback.autoReplyEligible, true);
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, false);
  assert.deepEqual(result.qualityIssues, []);
  assert.match(result.draft, /thank you so much/i);
  assert.match(result.draft, /take everything on board/i);
  assert.match(result.draft, /not up to scratch/i);
  assert.match(result.draft, /make it right next time/i);
  assert.doesNotMatch(result.draft, /Automated reply/i);
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

test("a date-change acknowledgement cannot give stale cancellation instructions", async () => {
  const requests = [];
  const result = await decideGuestResponse({
    guestMessage: "I made a mistake by booking 5 October instead of 5 September.",
    guestName: "Busisiwe",
    listingName: "Jasmine Studio Stay",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "OCT 5 – 6",
    latestEventAt: "2026-09-01T12:04:29.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecisionSequence([
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: true,
        summary: "The guest booked the wrong dates.",
        draft: "Thanks for clarifying. I’ll check availability. Please hold off on cancelling or making another booking until this is confirmed.",
      },
      {
        replyNeeded: true,
        sendReply: true,
        alertManagement: true,
        summary: "The guest booked the wrong dates.",
        draft: "Thanks for clarifying. I’ll check whether Jasmine is available for 5–6 September and whether the dates can be changed.",
      },
    ], (request) => requests.push(JSON.parse(request.input[1].content[0].text))),
  });

  assert.ok(requests[1].revisionFeedback.some((issue) => /do not instruct the guest to cancel/i.test(issue)));
  assert.equal(result.autoReply, true);
  assert.equal(result.alertManagement, true);
  assert.equal(result.qualityRevisionCount, 1);
  assert.doesNotMatch(result.draft, /cancel|rebook|another booking/i);
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

test("a bag-drop reply creates a separate dated cleaner operation", async () => {
  const requests = [];
  const result = await decideGuestResponse({
    guestMessage: "Could we check in at 11 or 12, or leave our bags there earlier?",
    guestName: "Asakhe",
    listingName: "The Spekboom Studio",
    facts: { checkInTime: "15:00", checkOutTime: "10:00" },
    stayLabel: "SEP 3 – 4",
    latestEventAt: "2026-08-30T16:00:00.000Z",
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: modelDecision({
      replyNeeded: true,
      sendReply: true,
      alertManagement: false,
      summary: "The guest asks about early check-in and bag drop.",
      draft: "Hi Asakhe, the earliest conditional check-in is 13:00, depending on cleaning. You’re welcome to leave your bags from 10:00 after the previous guest has actually checked out. If they leave late, bag drop starts only after their actual departure. This is luggage storage only and does not grant room access before cleaning is complete.",
    }, (request) => requests.push(JSON.parse(request.input[1].content[0].text))),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "offer_earliest");
  assert.equal(result.bagDropRequest.requestType, "bag_drop");
  assert.equal(result.bagDropRequest.effectiveTime, "10:00");
  assert.equal(result.bagDropRequest.createsOperationalRequest, true);
  assert.equal(requests[0].timePolicyDecision.action, "offer_earliest");
  assert.equal(requests[0].bagDropPolicyDecision.action, "accept_after_checkout");
});

const officeFacts = {
  checkInTime: "15:00", checkOutTime: "10:00",
  officeLuggageStorage: {
    allowed: true,
    location: "Office by the car park, through the glass doors",
    policy: "Guests are always welcome; no studio entry or checkout extension. Do not invent staffed hours or lost-property collection availability.",
  },
};
const officeDraft = "Of course, you are welcome to leave belongings in the Office by the car park, through the glass doors. This is luggage storage only and does not grant studio entry or extend checkout.";
const officeResult = (arrangement, draft = officeDraft) => ({
  replyNeeded: true, sendReply: true, alertManagement: false,
  summary: "Office storage arrangement.", draft, officeStorageArrangement: arrangement, roomTimingRequest: null,
});
const officeInput = {
  listingName: "Jasmine Studio Stay", facts: officeFacts,
  stayLabel: "SEP 10 - 11", latestEventAt: "2026-09-11T08:30:00Z",
  now: new Date("2026-09-12T08:30:00Z"), env: { OPENAI_API_KEY: "test-key" },
};

test("full-context office arrangements retain unknown drop times and the message-grounded date after checkout", async () => {
  let input;
  const result = await decideGuestResponse({
    ...officeInput,
    guestMessage: "That works for today, thank you.",
    conversationContext: [
      { direction: "guest", occurredAt: "2026-09-11T07:00:00Z", text: "May I leave belongings in the office until 4pm today?" },
      { direction: "host", occurredAt: "2026-09-11T07:05:00Z", text: "Of course, office storage is welcome." },
    ],
    fetchFn: modelDecision(officeResult({ date: "2026-09-11", dropTime: null }), (request) => {
      input = JSON.parse(request.input[1].content[0].text);
      assert.match(request.input[0].content[0].text, /pickup\/collect\/until time is NOT dropTime/);
      assert.match(request.input[0].content[0].text, /today\/tomorrow from the message that proposed the arrangement/);
      assert.match(request.input[0].content[0].text, /contextual follow-ups without bag-drop keywords/);
    }),
  });
  assert.equal(input.stayPhase, "after_stay");
  assert.equal(input.recentConversation.length, 2);
  assert.equal(result.operationalRequest, null);
  assert.equal(result.autoReply, true);
  assert.equal(result.bagDropRequest.action, "accept_office_storage");
  assert.deepEqual(result.bagDropRequest.officeStorageArrangement, { date: "2026-09-11", dropTime: null });
  assert.equal(result.bagDropRequest.requestedTime, null);
  assert.equal(result.bagDropRequest.effectiveTime, null);
  assert.equal(result.qualityRevisionCount, 0);
  const schema = SUPPORT_DECISION_SCHEMA.properties.officeStorageArrangement;
  assert.deepEqual(schema.type, ["object", "null"]);
  assert.deepEqual(schema.required, ["date", "dropTime"]);
  assert.deepEqual(schema.properties.date.type, ["string", "null"]);
  assert.deepEqual(schema.properties.dropTime.type, ["string", "null"]);
});

test("unknown office dates get one short clarification, never an arrival-date or midnight operation", async () => {
  const requests = [];
  const result = await decideGuestResponse({
    ...officeInput, guestMessage: "Can we leave our bags in the office?",
    fetchFn: modelDecisionSequence([
      officeResult({ date: null, dropTime: null }),
      officeResult({ date: null, dropTime: null }, `${officeDraft} Which day would you like to drop them off?`),
    ], (request) => requests.push(JSON.parse(request.input[1].content[0].text))),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.qualityRevisionCount, 1);
  assert.ok(requests[1].revisionFeedback.some((issue) => /date is unknown/.test(issue)));
  assert.equal(result.bagDropRequest.createsOperationalRequest, false);
  assert.equal(result.bagDropRequest.effectiveTime, null);
  assert.equal(result.bagDropRequest.officeStorageArrangement.date, null);
});

test("office storage does not require checkout-time verification or inherit the previous-guest condition", async () => {
  for (const checkOutTime of [null, "11:00"]) {
    const result = await decideGuestResponse({
      ...officeInput, facts: { ...officeFacts, checkOutTime },
      guestMessage: "May I drop my bags in the office tomorrow?",
      fetchFn: modelDecision(officeResult({ date: "2026-09-12", dropTime: null })),
    });
    assert.equal(result.autoReply, true);
    assert.equal(result.bagDropRequest.createsOperationalRequest, true);
  }
  const result = await decideGuestResponse({
    ...officeInput, guestMessage: "Can we drop bags in the office?",
    fetchFn: modelDecisionSequence([
      officeResult({ date: "2026-09-11", dropTime: null }, `${officeDraft} Bag drop starts only after the previous guest leaves.`),
      officeResult({ date: "2026-09-11", dropTime: null }),
    ]),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.qualityRevisionCount, 1);
});

test("genuine early studio entry remains an independent readiness operation beside office storage", async () => {
  const result = await decideGuestResponse({
    ...officeInput, stayLabel: "SEP 12 - 13", latestEventAt: "2026-09-11T08:30:00Z",
    guestMessage: "Can we check in early at 2pm tomorrow and drop bags in the office before that?",
    fetchFn: modelDecision({ ...officeResult({ date: "2026-09-12", dropTime: "08:30" },
      `${officeDraft} You can drop them off at 08:30. We will do our best for a 14:00 early check-in, depending on cleaning.`), roomTimingRequest: "Can we check in early at 2pm tomorrow?" }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "accept_conditional");
  assert.equal(result.operationalRequest.effectiveTime, "14:00");
  assert.equal(result.bagDropRequest.action, "accept_office_storage");
  assert.equal(result.bagDropRequest.effectiveTime, "08:30");
});

test("office-only until and arrival times do not invoke room checkout or earliest-entry rules", async () => {
  for (const fixture of [
    { message: "Can I leave my bags in the office until 4pm?", stayLabel: "SEP 10 - 11", dropTime: null },
    { message: "Can I arrive at 08:30 to leave bags in the office?", stayLabel: "SEP 11 - 12", dropTime: "08:30" },
    { message: "Can I arrive at 08:30?", stayLabel: "SEP 11 - 12", dropTime: "08:30",
      context: [{ direction: "host", occurredAt: "2026-09-10T07:00:00Z", text: "You can leave belongings in the office tomorrow morning; when will you drop them off?" }] },
  ]) {
    let calls = 0;
    const result = await decideGuestResponse({
      ...officeInput, latestEventAt: "2026-09-11T06:00:00Z", stayLabel: fixture.stayLabel,
      guestMessage: fixture.message, conversationContext: fixture.context ?? [],
      fetchFn: modelDecision(officeResult({ date: "2026-09-11", dropTime: fixture.dropTime },
        `${officeDraft}${fixture.dropTime ? " Your 08:30 drop-off is fine." : ""}`), (request) => {
        calls += 1;
        assert.match(request.input[0].content[0].text, /roomTimingRequest from the whole conversation/);
        assert.match(request.input[0].content[0].text, /provisional text-derived candidate/);
        assert.deepEqual(JSON.parse(request.input[1].content[0].text).recentConversation, fixture.context ?? []);
      }),
    });
    assert.equal(result.autoReply, true, fixture.message);
    assert.equal(result.operationalRequest, null);
    assert.equal(result.bagDropRequest.action, "accept_office_storage");
    assert.equal(result.bagDropRequest.effectiveTime, fixture.dropTime);
    assert.equal(calls, 1);
    assert.doesNotMatch(result.draft, /13:00|10:00|can't offer|cannot offer/);
  }
});

test("mixed office storage and actual late studio checkout retain the checkout boundary", async () => {
  const result = await decideGuestResponse({
    ...officeInput, latestEventAt: "2026-09-11T06:00:00Z",
    guestMessage: "Can I leave bags in the office until 4pm and check out of the studio at 12pm?",
    fetchFn: modelDecision({ ...officeResult({ date: "2026-09-11", dropTime: null },
      `${officeDraft} I am sorry, but we cannot offer late check-out; standard check-out is by 10:00.`), roomTimingRequest: "Can I check out of the studio at 12pm?" }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "decline");
  assert.equal(result.bagDropRequest.action, "accept_office_storage");
  assert.equal(result.bagDropRequest.effectiveTime, null);
});

test("mixed requests use the actual room time even when an office clock occurs later in the message", async () => {
  const result = await decideGuestResponse({
    ...officeInput, stayLabel: "SEP 11 - 12", latestEventAt: "2026-09-11T06:00:00Z",
    guestMessage: "Can we check in early at 2pm and leave our bags in the office until 4pm?",
    fetchFn: modelDecision({ ...officeResult({ date: "2026-09-11", dropTime: null },
      `${officeDraft} We will do our best for a 14:00 early check-in, depending on cleaning.`),
    roomTimingRequest: "Can we check in early at 2pm?" }),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.operationalRequest.action, "accept_conditional");
  assert.equal(result.operationalRequest.effectiveTime, "14:00");
  assert.equal(result.bagDropRequest.effectiveTime, null);
});

test("a no-reply acknowledgement of an established office arrangement stays quiet", async () => {
  const result = await decideGuestResponse({
    ...officeInput, latestEventAt: "2026-09-11T06:00:00Z", stayLabel: "SEP 11 - 12",
    guestMessage: "Tomorrow still works, thanks.",
    conversationContext: [{ direction: "host", occurredAt: "2026-09-11T05:00:00Z",
      text: "Your office storage is arranged for tomorrow; the drop-off time is not specified." }],
    fetchFn: modelDecision({ ...officeResult({ date: "2026-09-12", dropTime: null }, null),
      replyNeeded: false, sendReply: false, summary: "The guest confirms the unchanged office arrangement; no reply is needed." }),
  });
  assert.equal(result.replyNeeded, false);
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, false);
  assert.equal(result.operationalRequest, null);
  assert.equal(result.bagDropRequest, null);
  assert.equal(result.qualityRevisionCount, 0);
});

test("office context does not silence a genuine room timing request marked as needing no reply", async () => {
  const result = await decideGuestResponse({
    ...officeInput, latestEventAt: "2026-09-11T06:00:00Z", stayLabel: "SEP 11 - 12",
    guestMessage: "Could we check in early at 2pm as well?",
    fetchFn: modelDecision({ ...officeResult({ date: "2026-09-12", dropTime: null }, null),
      replyNeeded: false, sendReply: false, roomTimingRequest: "Could we check in early at 2pm?" }),
  });
  assert.equal(result.replyNeeded, true);
  assert.equal(result.autoReply, false);
  assert.equal(result.alertManagement, true);
});

test("an explicitly arranged 10:00 office drop-off is not confused with the studio checkout default", async () => {
  const result = await decideGuestResponse({
    ...officeInput, guestMessage: "May I drop my bags in the office tomorrow at 10:00?",
    fetchFn: modelDecision(officeResult({ date: "2026-09-12", dropTime: "10:00" },
      `${officeDraft} You can drop your bags from 10:00 as requested.`)),
  });
  assert.equal(result.autoReply, true);
  assert.equal(result.bagDropRequest.effectiveTime, "10:00");
  assert.equal(result.qualityRevisionCount, 0);
});

test("office storage permission does not authorize lost-property collection or unverified offices", async () => {
  const collection = await decideGuestResponse({
    ...officeInput, guestMessage: "Could I arrive at 4:15 pm to collect my charger?",
    conversationContext: [{ direction: "host", text: "Your charger is in the office; collection needs a confirmed handoff." }],
    fetchFn: modelDecision({
      ...officeResult(null, "We will need to confirm a handoff for your charger before agreeing on a collection time."),
      alertManagement: true,
    }),
  });
  assert.equal(collection.autoReply, true);
  assert.equal(collection.operationalRequest, null);
  assert.equal(collection.bagDropRequest, null);
  for (const facts of [{}, { officeLuggageStorage: { allowed: false } }, { officeLuggageStorage: { allowed: true } }]) {
    const result = await decideGuestResponse({
      ...officeInput, facts, guestMessage: "Tomorrow works.",
      fetchFn: modelDecision(officeResult({ date: "2026-09-12", dropTime: null })),
    });
    assert.equal(result.autoReply, false);
    assert.equal(result.bagDropRequest, null);
  }
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
