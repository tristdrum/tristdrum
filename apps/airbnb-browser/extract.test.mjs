import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ExtractionError, extractInbox, extractReservation, extractThread, isoDate } from "./extract.mjs";

const listing = { unitNumber: 2, name: "The Spekboom Studio" };
const barSummary = "Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 27, 2026.";

async function withPage(run) {
  const browser = await chromium.launch();
  try { await run(await browser.newPage()); }
  finally { await browser.close(); }
}

function detailHtml(code, profile = "") {
  return `<title>Edit calendar for 'The Spekboom Studio' - Airbnb</title>${profile}
    <div><div id="hosting-details-reservation-info-row-confirmation-code-row-title">Confirmation code</div><div>${code}</div></div>
    <span data-testid="guestFirstName">Synthetic</span>`;
}

test("reservation code is cross-checked against route and guest profile link", async () => withPage(async (page) => {
  await page.route("https://www.airbnb.co.za/**", (route) => route.fulfill({ contentType: "text/html", body: detailHtml("TESTCODE1", '<a href="https://www.airbnb.co.za/users/profile/000000001">Profile</a>') }));
  await page.goto("https://www.airbnb.co.za/multicalendar/102/reservation/TESTCODE1");
  assert.deepEqual(await extractReservation(page, listing, barSummary), {
    confirmationCode: "TESTCODE1", unitNumber: 2, listingName: listing.name, guestName: "Synthetic",
    guestProfileId: "000000001", checkIn: "2026-09-24", checkOut: "2026-09-27", status: "calendar_reservation",
  });
  await page.setContent(detailHtml("WRONGCODE", ""));
  await assert.rejects(extractReservation(page, listing, barSummary), ExtractionError);
  assert.throws(() => isoDate("31 Sep 2026"), ExtractionError);
}));

test("same guest identity is link-derived, never display-name-derived", async () => withPage(async (page) => {
  await page.route("https://www.airbnb.co.za/**", (route) => route.fulfill({ contentType: "text/html", body: detailHtml("TESTCODE1") }));
  await page.goto("https://www.airbnb.co.za/multicalendar/102/reservation/TESTCODE1");
  const link = '<a href="https://www.airbnb.co.za/users/profile/000000001">Profile</a>';
  await page.setContent(detailHtml("TESTCODE1", link));
  assert.equal((await extractReservation(page, listing, barSummary)).guestProfileId, "000000001");
  await page.setContent(detailHtml("TESTCODE1"));
  assert.equal((await extractReservation(page, listing, barSummary)).guestProfileId, null);
  await page.setContent(detailHtml("TESTCODE1", `<div style="display:none">${link}</div>`));
  assert.equal((await extractReservation(page, listing, barSummary)).guestProfileId, null);
  await page.setContent(detailHtml("TESTCODE1", `${link}<a href="https://www.airbnb.co.za/users/profile/000000002">Other profile</a>`));
  assert.equal((await extractReservation(page, listing, barSummary)).guestProfileId, null);
}));

test("real-shape inbox IDs are scoped; uncalibrated message history fails closed", async () => withPage(async (page) => {
  await page.setContent('<h1>Messages</h1><div id="list_inbox" aria-label="List of Conversations"><div data-listrow><div data-testid="inbox_list_123"></div></div></div>');
  assert.deepEqual(await extractInbox(page), ["https://www.airbnb.co.za/hosting/messages/123"]);
  await page.setContent('<h1>Messages</h1><div id="list_inbox" aria-label="List of Conversations"><div data-testid="inbox_list_123"></div></div><button aria-label="Load more">More</button>');
  await assert.rejects(extractInbox(page), ExtractionError);
  await page.setContent('<div data-testid="message-list"><div data-testid="MessageOuterRegistryWrapperSpacingProps"><div data-testid="html-rich-text-container">Synthetic text</div></div></div>');
  await assert.rejects(extractThread(page, "https://www.airbnb.co.za/hosting/messages/123"), /need live calibration/);
}));
