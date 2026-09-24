import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ExtractionError, extractCalendarViewport, extractInbox, extractReservation, extractThread, isoDate, reservationIntervals } from "./extract.mjs";

const listing = { unitNumber: 2, name: "The Spekboom Studio" };
const barSummary = "Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 27, 2026.";

async function withPage(run) {
  const browser = await chromium.launch();
  try { await run(await browser.newPage()); }
  finally { await browser.close(); }
}

function detailHtml(code, profile = "", { status = "Upcoming guests", group = 2, labels = ["2 adults"] } = {}) {
  return `<title>Edit calendar for 'The Spekboom Studio' - Airbnb</title>${profile}
    ${status ? `<h2>${status}</h2>` : ""}<h3>Synthetic group of ${group}</h3>
    <button data-testid="hosting-details-whos-coming"><span>Guests</span>${labels.map((label) => `<span>${label}</span>`).join("")}</button>
    <div><div id="hosting-details-reservation-info-row-confirmation-code-row-title">Confirmation code</div><div>${code}</div></div>
    <span data-testid="guestFirstName">Synthetic</span>`;
}

test("turnover descriptions retain both adjacent intervals and reject malformed pairs", () => {
  const two = "Reservation Synthetic A Checkin on Sep 22, 2026, checkout on Sep 25, 2026. Reservation Synthetic B Checkin on Sep 25, 2026, checkout on Sep 27, 2026.";
  assert.deepEqual(reservationIntervals(two).map((item) => item.key), ["2026-09-22|2026-09-25", "2026-09-25|2026-09-27"]);
  assert.throws(() => reservationIntervals(`${two} Reservation Missing dates`), /missing or malformed/);
});

test("three-month viewport reconciles both turnover intervals with both bars", async () => withPage(async (page) => {
  const first = "Reservation Synthetic A Checkin on Sep 22, 2026, checkout on Sep 25, 2026.";
  const second = "Reservation Synthetic B Checkin on Sep 25, 2026, checkout on Sep 27, 2026.";
  const grids = [8, 9, 10].map((month) => {
    const name = new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const key = `2026-${String(month).padStart(2, "0")}`;
    const count = new Date(Date.UTC(2026, month, 0)).getUTCDate();
    const cells = Array.from({ length: count }, (_, index) => {
      const date = `${key}-${String(index + 1).padStart(2, "0")}`;
      const turnover = date === "2026-09-25";
      return `<div role="gridcell"><button data-date="${date}" ${turnover ? 'aria-describedby="RESERVATION_TURNOVER"' : date < "2026-09-24" ? "disabled" : ""}>${turnover ? "25" : "Nightly price R 100"}</button></div>`;
    }).join("");
    return `<div role="grid" aria-label="${name}">${cells}</div>`;
  }).join("");
  const bars = `<div data-testid="reservation-bar" data-selector="reservation-bar-2026-09-22">${first}</div>
    <div data-testid="reservation-bar" data-selector="reservation-bar-2026-09-25">${second}</div>`;
  const html = (items) => `<title>Edit calendar for 'The Spekboom Studio' - Airbnb</title>${grids}
    <div id="RESERVATION_TURNOVER">${first} ${second}</div>${items}`;
  await page.setContent(html(bars));
  const result = await extractCalendarViewport(page, listing.name, "2026-09-24");
  assert.deepEqual(result.expectedIntervals, ["2026-09-22|2026-09-25", "2026-09-25|2026-09-27"]);
  assert.equal(result.barTargets.length, 2);
  await page.setContent(html(bars.replace(/<div data-testid="reservation-bar" data-selector="reservation-bar-2026-09-25">.*?<\/div>/, "")));
  await assert.rejects(extractCalendarViewport(page, listing.name, "2026-09-24"), /disagree/);
  await page.setContent(html(bars).replaceAll("Checkin on Sep 25, 2026", "Checkin on Sep 24, 2026"));
  await assert.rejects(extractCalendarViewport(page, listing.name, "2026-09-24"), /Overlapping reservation intervals/);
}));

test("reservation code is cross-checked against route and guest profile link", async () => withPage(async (page) => {
  await page.route("https://www.airbnb.co.za/**", (route) => route.fulfill({ contentType: "text/html", body: detailHtml("TESTCODE1", '<a href="https://www.airbnb.co.za/users/profile/000000001">Profile</a>') }));
  await page.goto("https://www.airbnb.co.za/multicalendar/102/reservation/TESTCODE1");
  assert.deepEqual(await extractReservation(page, listing, barSummary), {
    confirmationCode: "TESTCODE1", unitNumber: 2, listingName: listing.name, guestName: "Synthetic",
    guestProfileId: "000000001", guestCount: 2, guestComposition: { adults: 2, children: 0, infants: 0 },
    checkIn: "2026-09-24", checkOut: "2026-09-27", status: "upcoming_guests",
  });
  await page.setContent(detailHtml("WRONGCODE", ""));
  await assert.rejects(extractReservation(page, listing, barSummary), ExtractionError);
  assert.throws(() => isoDate("31 Sep 2026"), ExtractionError);
}));

test("visible 1-adult-1-child differs from 2 adults and must reconcile with group total", async () => withPage(async (page) => {
  await page.route("https://www.airbnb.co.za/**", (route) => route.fulfill({ contentType: "text/html", body: detailHtml("TESTCODE1") }));
  await page.goto("https://www.airbnb.co.za/multicalendar/102/reservation/TESTCODE1");
  await page.setContent(detailHtml("TESTCODE1", "", { labels: ["1 adult", "1 child"] }));
  const family = await extractReservation(page, listing, barSummary);
  assert.deepEqual(family.guestComposition, { adults: 1, children: 1, infants: 0 });
  await page.setContent(detailHtml("TESTCODE1", "", { labels: ["2 adults"] }));
  const adults = await extractReservation(page, listing, barSummary);
  assert.deepEqual(adults.guestComposition, { adults: 2, children: 0, infants: 0 });
  assert.equal(family.guestCount, adults.guestCount);
  await page.setContent(detailHtml("TESTCODE1", "", { labels: ["1 adult"] }));
  await assert.rejects(extractReservation(page, listing, barSummary), /does not reconcile/);
  await page.setContent(detailHtml("TESTCODE1", "", { group: 3, labels: ["2 adults", "1 infant"] }));
  assert.deepEqual((await extractReservation(page, listing, barSummary)).guestComposition, { adults: 2, children: 0, infants: 1 });
}));

test("visible pending and cancelled statuses stay distinct; missing status fails closed", async () => withPage(async (page) => {
  await page.route("https://www.airbnb.co.za/**", (route) => route.fulfill({ contentType: "text/html", body: detailHtml("TESTCODE1") }));
  await page.goto("https://www.airbnb.co.za/multicalendar/102/reservation/TESTCODE1");
  await page.setContent(detailHtml("TESTCODE1", "", { status: "Pending request" }));
  assert.equal((await extractReservation(page, listing, barSummary)).status, "pending_request");
  await page.setContent(detailHtml("TESTCODE1", "", { status: "Cancelled" }));
  assert.equal((await extractReservation(page, listing, barSummary)).status, "cancelled");
  await page.setContent(detailHtml("TESTCODE1", "", { status: "" }));
  await assert.rejects(extractReservation(page, listing, barSummary), /status or guest composition is not explicit/);
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
  await page.setContent('<h1>Messages</h1><div id="list_inbox" aria-label="List of Conversations"><div data-listrow><div data-testid="inbox_list_123"></div></div><div data-listrow><div>Unknown conversation</div></div></div>');
  await assert.rejects(extractInbox(page), /layout or pagination changed/);
  await page.setContent('<div data-testid="message-list"><div data-testid="MessageOuterRegistryWrapperSpacingProps"><div data-testid="html-rich-text-container">Synthetic text</div></div></div>');
  await assert.rejects(extractThread(page, "https://www.airbnb.co.za/hosting/messages/123"), /need live calibration/);
}));
