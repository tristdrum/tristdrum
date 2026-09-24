import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { LISTINGS } from "./config.mjs";
import { AuthExpiredError, installReadOnlyNetwork, scanCalendars, scanMessages, withAirbnbBrowser } from "./browser.mjs";
import { ExtractionError } from "./extract.mjs";

const calendarUrls = Object.fromEntries(LISTINGS.map((listing) => [listing.unitNumber, `https://www.airbnb.co.za/multicalendar/${100 + listing.unitNumber}`]));

function calendarHtml(listing, partial = false) {
  const grids = [8, 9, 10].map((month) => {
    const key = `2026-${String(month).padStart(2, "0")}`;
    const name = new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const count = new Date(Date.UTC(2026, month, 0)).getUTCDate() - (partial && month === 9 ? 1 : 0);
    const cells = Array.from({ length: count }, (_, index) => {
      const day = index + 1;
      const date = `${key}-${String(day).padStart(2, "0")}`;
      const booked = month === 9 && day === 24;
      const past = date < "2026-09-24";
      return `<div role="gridcell" data-calendar-day="true"><button data-date="${date}" ${booked ? `aria-describedby="RESERVATION_${date}"` : ""} ${past ? "disabled" : ""}>${booked ? `${day}` : past ? `${day}` : `${day} Nightly price R 100`}</button></div>${booked ? `<div id="RESERVATION_${date}">Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 26, 2026.</div>` : ""}`;
    }).join("");
    return `<div role="grid" aria-label="${name}"><div role="row">${cells}</div></div>`;
  }).join("");
  const code = `TESTCODE${listing.unitNumber}`;
  return `<!doctype html><title>Edit calendar for '${listing.name}' - Airbnb</title><h1>Calendar</h1>${grids}
    <div role="button" onclick="history.pushState({}, '', '/multicalendar/${100 + listing.unitNumber}/reservation/${code}'); document.querySelector('#detail').innerHTML = '<div id=hosting-details-reservation-info-row-confirmation-code-row-title>Confirmation code</div><div>${code}</div><span data-testid=guestFirstName>Synthetic</span><a href=/users/profile/00000000${listing.unitNumber}>Guest profile</a>'">
      <div data-testid="reservation-bar" data-selector="reservation-bar-2026-09-24">Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 26, 2026.</div>
    </div><div id="detail"></div>`;
}

async function withFixtureContext(routeHandler, work) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.route("https://www.airbnb.co.za/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: routeHandler(new URL(route.request().url()), route.request().method()) }));
    await work(context);
  } finally { await browser.close(); }
}

test("three real-shape calendar grids yield synthetic code and profile details", async () => {
  await withFixtureContext((url) => calendarHtml(LISTINGS[Number(url.pathname.split("/").at(-1)) - 101]), async (context) => {
    const snapshot = await scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z"));
    assert.equal(snapshot.listings.length, 3);
    assert.deepEqual(snapshot.listings.map((item) => item.reservations[0].confirmationCode), ["TESTCODE1", "TESTCODE2", "TESTCODE3"]);
    assert.deepEqual(snapshot.listings.map((item) => item.reservations[0].guestProfileId), ["000000001", "000000002", "000000003"]);
    assert.deepEqual(snapshot.listings[0].months.map((item) => item.month), ["2026-08", "2026-09", "2026-10"]);
    assert.equal(snapshot.listings[0].reservations[0].status, "calendar_reservation");
  });
});

test("partial real-shape grid blocks the entire calendar refresh", async () => {
  await withFixtureContext((url) => calendarHtml(LISTINGS[Number(url.pathname.split("/").at(-1)) - 101], true), async (context) => {
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), ExtractionError);
  });
});

test("POST-dependent synthetic calendar is blocked and cannot become complete", async () => {
  let postReachedFixture = false;
  await withFixtureContext((_url, method) => {
    if (method === "POST") postReachedFixture = true;
    return `<!doctype html><title>Edit calendar for 'Bougainvillea Courtyard Studio' - Airbnb</title><h1>Calendar</h1>
      <div role="grid" aria-label="August 2026"></div><div role="grid" aria-label="September 2026"></div><div role="grid" aria-label="October 2026"></div>
      <script>fetch('/multicalendar/data', {method: 'POST', body: '{}'}).catch(() => {});</script>`;
  }, async (context) => {
    const methods = [];
    context.on("request", (request) => methods.push(request.method()));
    await installReadOnlyNetwork(context);
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), ExtractionError);
    assert.equal(methods.includes("POST"), true);
  });
  assert.equal(postReachedFixture, false);
});

test("Messages index IDs form scoped thread URLs for synthetic thread reads", async () => {
  await withFixtureContext((url) => url.pathname === "/hosting/messages" ?
    '<h1>Messages</h1><div id="list_inbox" aria-label="List of Conversations"><div data-listrow><div data-testid="inbox_list_123"></div></div></div>' :
    '<h1>The Spekboom Studio</h1><article data-message-id="m1" data-sender="Synthetic Guest"><time datetime="2026-09-24T08:00:00Z"></time><p>Synthetic question</p></article>', async (context) => {
    const result = await scanMessages(context, { messagesUrl: "https://www.airbnb.co.za/hosting/messages" });
    assert.equal(result.threads[0].threadId, "123");
  });
});

test("on-demand browser refuses absent login state and launches without navigation", async () => {
  await assert.rejects(withAirbnbBrowser(null, async () => ({})), AuthExpiredError);
  const result = await withAirbnbBrowser({ cookies: [{ name: "synthetic", value: "fixture", domain: ".airbnb.co.za", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] }, async () => ({ ok: true }));
  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.transferredBytes, 0);
});
