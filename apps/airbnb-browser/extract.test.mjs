import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ExtractionError, extractCalendarMonth, extractInbox, extractReservation, extractThread, isoDate } from "./extract.mjs";

const listing = { unitNumber: 2, name: "The Spekboom Studio" };

async function withPage(run) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await run(page);
  } finally { await browser.close(); }
}

function calendarHtml({ missingDay = false, unknown = false } = {}) {
  const cells = Array.from({ length: missingDay ? 29 : 30 }, (_, index) => {
    const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
    const status = index === 1 ? "reserved" : unknown && index === 2 ? "mystery" : "available";
    return `<div role="gridcell" data-date="${date}" data-status="${status}">${date}</div>`;
  }).join("");
  return `<h1>The Spekboom Studio</h1><h2>September 2026</h2><div role="grid">${cells}</div><a href="https://www.airbnb.com/hosting/reservations/details/123">Reservation</a>`;
}

test("calendar extractor records every day and reservation link", async () => withPage(async (page) => {
  await page.setContent(calendarHtml());
  const month = await extractCalendarMonth(page, listing.name);
  assert.equal(month.month, "2026-09");
  assert.equal(month.days.length, 30);
  assert.equal(month.days[1].status, "reserved");
  assert.equal(month.reservationUrls.length, 1);
}));

test("calendar layout changes and partial months fail closed", async () => withPage(async (page) => {
  await page.setContent(calendarHtml({ missingDay: true }));
  await assert.rejects(extractCalendarMonth(page, listing.name), ExtractionError);
  await page.setContent(calendarHtml({ unknown: true }));
  await assert.rejects(extractCalendarMonth(page, listing.name), ExtractionError);
  await page.setContent(calendarHtml().replace("The Spekboom Studio", "Wrong listing"));
  await assert.rejects(extractCalendarMonth(page, listing.name), ExtractionError);
}));

test("reservation extractor requires exact labelled booking fields", async () => withPage(async (page) => {
  const html = `<a data-testid="guest-profile-link" href="https://www.airbnb.com/users/show/000000001">View guest profile</a>
    <dl><dt>Confirmation code</dt><dd>TESTCODE1</dd><dt>Guest</dt><dd>Synthetic Guest</dd>
    <dt>Listing</dt><dd>The Spekboom Studio</dd><dt>Check-in</dt><dd>24 Sep 2026</dd>
    <dt>Check-out</dt><dd>27 Sep 2026</dd><dt>Status</dt><dd>Confirmed</dd></dl>`;
  await page.setContent(html);
  assert.deepEqual(await extractReservation(page, listing), {
    confirmationCode: "TESTCODE1", unitNumber: 2, listingName: listing.name, guestName: "Synthetic Guest", guestProfileId: "000000001",
    checkIn: "2026-09-24", checkOut: "2026-09-27", status: "confirmed",
  });
  await page.setContent(html.replace("TESTCODE1", ""));
  await assert.rejects(extractReservation(page, listing), ExtractionError);
  assert.throws(() => isoDate("31 Sep 2026"), ExtractionError);
}));

test("adjacent synthetic bookings share identity only through a visible profile link", async () => withPage(async (page) => {
  const detail = (code, link = "") => `${link}<dl><dt>Confirmation code</dt><dd>${code}</dd><dt>Guest</dt><dd>Same Display Name</dd>
    <dt>Listing</dt><dd>The Spekboom Studio</dd><dt>Check-in</dt><dd>24 Sep 2026</dd>
    <dt>Check-out</dt><dd>25 Sep 2026</dd><dt>Status</dt><dd>Confirmed</dd></dl>`;
  const link = '<a data-testid="guest-profile-link" href="https://www.airbnb.com/users/show/000000001">View guest profile</a>';
  await page.setContent(detail("TESTCODE1", link));
  const first = await extractReservation(page, listing);
  await page.setContent(detail("TESTCODE2", link));
  const second = await extractReservation(page, listing);
  assert.equal(first.guestProfileId, second.guestProfileId);
  await page.setContent(detail("TESTCODE3"));
  assert.equal((await extractReservation(page, listing)).guestProfileId, null);
  await page.setContent(detail("TESTCODE4", '<a data-testid="guest-profile-link" style="display:none" href="https://www.airbnb.com/users/show/000000001">Hidden profile</a>'));
  assert.equal((await extractReservation(page, listing)).guestProfileId, null);
  await page.setContent(detail("TESTCODE5", `${link}<a data-testid="guest-profile-link" href="https://www.airbnb.com/users/show/000000002">Other profile</a>`));
  assert.equal((await extractReservation(page, listing)).guestProfileId, null);
}));

test("inbox and thread extraction reject unbounded pagination or missing message fields", async () => withPage(async (page) => {
  await page.setContent(`<h1>Messages</h1><a href="https://www.airbnb.com/hosting/messages/123">Thread</a>`);
  assert.deepEqual(await extractInbox(page), ["https://www.airbnb.com/hosting/messages/123"]);
  await page.setContent(`<h1>Messages</h1><button aria-label="Load more">More</button><a href="https://www.airbnb.com/hosting/messages/123">Thread</a>`);
  await assert.rejects(extractInbox(page), ExtractionError);
  const thread = `<h1>The Spekboom Studio</h1><article data-message-id="m1" data-sender="Guest"><time datetime="2026-09-24T08:00:00Z"></time><p>Can I arrive at 15:00?</p></article>`;
  await page.setContent(thread);
  assert.equal((await extractThread(page, "https://www.airbnb.com/hosting/messages/123")).messages[0].body, "Can I arrive at 15:00?");
  await page.setContent(thread.replace("data-sender=\"Guest\"", ""));
  await assert.rejects(extractThread(page, "https://www.airbnb.com/hosting/messages/123"), ExtractionError);
}));
