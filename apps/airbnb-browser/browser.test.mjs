import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { chromium } from "playwright";
import { LISTINGS } from "./config.mjs";
import { AuthExpiredError, allowedReadRequest, handleReadOnlyRoute, installReadOnlyNetwork, scanCalendars, scanMessages, withAirbnbBrowser } from "./browser.mjs";
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
    <div role="button" onclick="history.pushState({}, '', '/multicalendar/${100 + listing.unitNumber}/reservation/${code}'); document.querySelector('#detail').innerHTML = '<h2>Upcoming guests</h2><h3>Synthetic group of 2</h3><button data-testid=hosting-details-whos-coming><span>Guests</span><span>2 adults</span></button><div id=hosting-details-reservation-info-row-confirmation-code-row-title>Confirmation code</div><div>${code}</div><span data-testid=guestFirstName>Synthetic</span><a href=/users/profile/00000000${listing.unitNumber}>Guest profile</a>'">
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
    assert.equal(snapshot.listings[0].reservations[0].status, "upcoming_guests");
    assert.equal(snapshot.listings[0].reservations[0].guestCount, 2);
    assert.deepEqual(snapshot.listings[0].reservations[0].guestComposition, { adults: 2, children: 0, infants: 0 });
  });
});

test("partial real-shape grid blocks the entire calendar refresh", async () => {
  await withFixtureContext((url) => calendarHtml(LISTINGS[Number(url.pathname.split("/").at(-1)) - 101], true), async (context) => {
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), ExtractionError);
  });
});

test("unknown reservation bars cannot be ignored beside a valid booking", async () => {
  await withFixtureContext((url) => calendarHtml(LISTINGS[Number(url.pathname.split("/").at(-1)) - 101])
    .replace('<div id="detail"></div>', '<div data-testid="reservation-bar" data-selector="unexpected">Reservation Unparsed</div><div id="detail"></div>'), async (context) => {
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), /Unrecognized reservation bar/);
  });
});

test("every reserved interval must agree with a bar and a fully extracted detail", async () => {
  await withFixtureContext((url) => calendarHtml(LISTINGS[Number(url.pathname.split("/").at(-1)) - 101])
    .replace(/data-selector="reservation-bar-2026-09-24">Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 26, 2026\./,
      'data-selector="reservation-bar-2026-09-24">Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 27, 2026.'), async (context) => {
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), /Reserved intervals and reservation bars disagree/);
  });
  await withFixtureContext((url) => calendarHtml(LISTINGS[Number(url.pathname.split("/").at(-1)) - 101])
    .replace(/<div>TESTCODE1<\/div>/, '<div>WRONGCODE</div>'), async (context) => {
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), /Reservation code or guest detail is incomplete/);
  });
});

test("two bars on one interval must resolve to the same exact booking", async () => {
  await withFixtureContext((url) => {
    const listing = LISTINGS[Number(url.pathname.split("/").at(-1)) - 101];
    const original = calendarHtml(listing);
    if (listing.unitNumber !== 1) return original;
    const extra = `<div role="button" onclick="history.pushState({}, '', '/multicalendar/101/reservation/TESTCODE9'); document.querySelector('#detail').innerHTML = '<h2>Upcoming guests</h2><h3>Synthetic group of 2</h3><button data-testid=hosting-details-whos-coming><span>Guests</span><span>2 adults</span></button><div id=hosting-details-reservation-info-row-confirmation-code-row-title>Confirmation code</div><div>TESTCODE9</div><span data-testid=guestFirstName>Synthetic</span><a href=/users/profile/000000001>Guest profile</a>'">
      <div data-testid="reservation-bar" data-selector="reservation-bar-2026-09-25">Reservation Synthetic Guest Checkin on Sep 24, 2026, checkout on Sep 26, 2026.</div></div>`;
    return original.replace('<div id="detail"></div>', `${extra}<div id="detail"></div>`);
  }, async (context) => {
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), /conflicting reservation details/);
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
    await context.route("**/*", (route) => {
      const request = route.request();
      return allowedReadRequest(request.url(), request.method(), request.resourceType()) ? route.fallback() : route.abort();
    });
    await assert.rejects(scanCalendars(context, { calendarUrls }, undefined, new Date("2026-09-24T10:00:00Z")), ExtractionError);
    assert.equal(methods.includes("POST"), true);
  });
  assert.equal(postReachedFixture, false);
});

test("all redirect responses are blocked before browser fulfillment, including cross-host and HTTP targets", async () => {
  const run = async (location, url = "https://www.airbnb.co.za/multicalendar/101") => {
    const calls = { fetched: 0, aborted: 0, fulfilled: 0, maxRedirects: null };
    const route = {
      request: () => ({ url: () => url, method: () => "GET", resourceType: () => "document" }),
      fetch: async (options) => { calls.fetched += 1; calls.maxRedirects = options.maxRedirects; return { status: () => 302, headers: () => ({ Location: location }) }; },
      abort: async () => { calls.aborted += 1; },
      fulfill: async () => { calls.fulfilled += 1; },
    };
    await handleReadOnlyRoute(route);
    return calls;
  };
  assert.deepEqual(await run("https://evil.example/steal"), { fetched: 1, aborted: 1, fulfilled: 0, maxRedirects: 0 });
  assert.deepEqual(await run("http://www.airbnb.co.za/multicalendar/101"), { fetched: 1, aborted: 1, fulfilled: 0, maxRedirects: 0 });
  assert.deepEqual(await run("https://www.airbnb.co.za/multicalendar/102"), { fetched: 1, aborted: 1, fulfilled: 0, maxRedirects: 0 });
  assert.deepEqual(await run("https://evil.example/steal", "https://www.airbnb.co.za/multicalendar/102"), { fetched: 1, aborted: 1, fulfilled: 0, maxRedirects: 0 });
});

test("Playwright never receives a synthetic redirect target", async () => {
  const local = createServer((request, response) => {
    const target = new URL(request.url, "http://127.0.0.1").searchParams.get("to");
    response.writeHead(302, { Location: target });
    response.end();
  }).listen(0, "127.0.0.1");
  await once(local, "listening");
  const browser = await chromium.launch();
  try {
    for (const forbidden of ["https://evil.example/steal", "http://www.airbnb.co.za/multicalendar/103"]) {
      const context = await browser.newContext();
      const seen = [];
      await installReadOnlyNetwork(context, () => 0, async (route) => {
        seen.push(new URL(route.request().url()).pathname);
        return context.request.get(`http://127.0.0.1:${local.address().port}/redirect?to=${encodeURIComponent(forbidden)}`, { maxRedirects: 0 });
      });
      try {
        const page = await context.newPage();
        await page.goto("https://www.airbnb.co.za/multicalendar/101", { timeout: 5_000 }).catch(() => {});
        assert.deepEqual(seen, ["/multicalendar/101"]);
        assert.equal(page.url().startsWith(forbidden), false);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); local.close(); await once(local, "close"); }
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
