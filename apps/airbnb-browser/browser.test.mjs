import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { LISTINGS } from "./config.mjs";
import { AuthExpiredError, installReadOnlyNetwork, scanCalendars, scanMessages, withAirbnbBrowser } from "./browser.mjs";
import { ExtractionError } from "./extract.mjs";

function calendarHtml(listing, partial = false) {
  return `<!doctype html><h1>${listing.name}</h1><h2 data-testid="calendar-month"></h2>
    <div id="days"></div><button aria-label="Next month" onclick="month += 1; render()">Next month</button>
    <script>
      let month = 8;
      function render() {
        const date = new Date(Date.UTC(2026, month, 1));
        const key = date.toISOString().slice(0, 7);
        document.querySelector('h2').textContent = date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const count = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate() - (${partial} ? 1 : 0);
        document.querySelector('#days').innerHTML = Array.from({length: count}, (_, index) =>
          '<div data-date="' + key + '-' + String(index + 1).padStart(2, '0') + '" data-status="' + (month === 8 && index === 0 ? 'reserved' : 'available') + '"></div>'
        ).join('') + (month === 8 ? '<a href="https://www.airbnb.com/hosting/reservations/details/${listing.unitNumber}">Details</a>' : '');
      }
      render();
    </script>`;
}

function reservationHtml(listing) {
  return `<button aria-label="More options" onclick="document.querySelector('#code').innerHTML = '<dt>Confirmation code</dt><dd>TESTCODE${listing.unitNumber}</dd>'">More</button>
    <dl id="code"></dl><a data-testid="guest-profile-link" href="https://www.airbnb.com/users/show/00000000${listing.unitNumber}">View guest profile</a><dl>
    <dt>Guest</dt><dd>Synthetic Guest ${listing.unitNumber}</dd>
    <dt>Listing</dt><dd>${listing.name}</dd><dt>Check-in</dt><dd>1 Sep 2026</dd>
    <dt>Check-out</dt><dd>3 Sep 2026</dd><dt>Status</dt><dd>Confirmed</dd></dl>`;
}

async function withFixtureContext(routeHandler, work) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.route("https://www.airbnb.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: routeHandler(new URL(route.request().url()), route.request().method()) }));
    await work(context);
  } finally { await browser.close(); }
}

test("browser orchestration reads all three synthetic calendars and exact details", async () => {
  await withFixtureContext((url) => {
    if (url.pathname === "/hosting/calendar") return calendarHtml(LISTINGS[Number(url.searchParams.get("listingId")) - 1]);
    const listing = LISTINGS[Number(url.pathname.split("/").at(-1)) - 1];
    return reservationHtml(listing);
  }, async (context) => {
    const config = { calendarUrls: Object.fromEntries(LISTINGS.map((item) => [item.unitNumber, `https://www.airbnb.com/hosting/calendar?listingId=${item.unitNumber}`])) };
    const snapshot = await scanCalendars(context, config, undefined, new Date("2026-09-24T10:00:00Z"));
    assert.equal(snapshot.listings.length, 3);
    assert.deepEqual(snapshot.listings.map((item) => item.reservations[0].confirmationCode), ["TESTCODE1", "TESTCODE2", "TESTCODE3"]);
    assert.deepEqual(snapshot.listings.map((item) => item.reservations[0].guestProfileId), ["000000001", "000000002", "000000003"]);
    assert.deepEqual(snapshot.listings[0].months.map((item) => item.month), ["2026-09", "2026-10", "2026-11"]);
  });
});

test("partial month blocks the entire calendar refresh", async () => {
  await withFixtureContext((url) => url.pathname === "/hosting/calendar" ? calendarHtml(LISTINGS[Number(url.searchParams.get("listingId")) - 1], true) : reservationHtml(LISTINGS[0]), async (context) => {
    const config = { calendarUrls: Object.fromEntries(LISTINGS.map((item) => [item.unitNumber, `https://www.airbnb.com/hosting/calendar?listingId=${item.unitNumber}`])) };
    await assert.rejects(scanCalendars(context, config, undefined, new Date("2026-09-24T10:00:00Z")), ExtractionError);
  });
});

test("POST-dependent synthetic calendar is blocked and cannot become complete", async () => {
  let postReachedFixture = false;
  await withFixtureContext((_url, method) => {
    if (method === "POST") postReachedFixture = true;
    return `<!doctype html><h1>Bougainvillea Courtyard Studio</h1><h2>September 2026</h2>
      <div id="days"></div><script>fetch('/hosting/calendar/data', {method: 'POST', body: '{}'})
      .then(response => response.text()).then(html => document.querySelector('#days').innerHTML = html).catch(() => {});</script>`;
  }, async (context) => {
    const methods = [];
    context.on("request", (request) => methods.push(request.method()));
    await installReadOnlyNetwork(context);
    const config = { calendarUrls: { 1: "https://www.airbnb.com/hosting/calendar?listingId=1" } };
    await assert.rejects(scanCalendars(context, config, undefined, new Date("2026-09-24T10:00:00Z")), ExtractionError);
    assert.equal(methods.includes("POST"), true);
  });
  assert.equal(postReachedFixture, false);
});

test("browser orchestration reads synthetic guest thread and no extras", async () => {
  await withFixtureContext((url) => url.pathname === "/hosting/messages" ?
    '<h1>Messages</h1><a href="https://www.airbnb.com/hosting/messages/123">Synthetic guest</a>' :
    '<h1>The Spekboom Studio</h1><article data-message-id="m1" data-sender="Synthetic Guest"><time datetime="2026-09-24T08:00:00Z"></time><p>Synthetic question</p></article>', async (context) => {
    const result = await scanMessages(context, { messagesUrl: "https://www.airbnb.com/hosting/messages" });
    assert.equal(result.threads.length, 1);
    assert.equal(result.threads[0].messages[0].body, "Synthetic question");
  });
});

test("on-demand browser refuses absent login state and can launch without navigation", async () => {
  await assert.rejects(withAirbnbBrowser(null, async () => ({})), AuthExpiredError);
  const result = await withAirbnbBrowser({ cookies: [{ name: "synthetic", value: "fixture", domain: ".airbnb.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] }, async () => ({ ok: true }));
  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.transferredBytes, 0);
});
