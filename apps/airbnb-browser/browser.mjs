import { chromium } from "playwright";
import { LISTINGS } from "./config.mjs";
import { monthKey } from "./budget.mjs";
import { ExtractionError, extractCalendarViewport, extractInbox, extractReservation, extractThread } from "./extract.mjs";

const MAX_RESERVATIONS = 40;
const MAX_THREADS = 30;
const MAX_RUN_BYTES = 50 * 1024 * 1024;
const MAX_RUN_MS = 120_000;

export class AuthExpiredError extends Error {
  constructor() { super("Airbnb login is missing or expired"); this.name = "AuthExpiredError"; }
}

export function allowedReadRequest(url, method, resourceType) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === "https:" &&
    (parsed.hostname === "airbnb.co.za" || parsed.hostname.endsWith(".airbnb.co.za") ||
      parsed.hostname === "airbnb.com" || parsed.hostname.endsWith(".airbnb.com") ||
      parsed.hostname === "muscache.com" || parsed.hostname.endsWith(".muscache.com")) &&
    ["GET", "HEAD", "OPTIONS"].includes(method) &&
    !["image", "font", "media", "websocket", "eventsource"].includes(resourceType);
}

export async function installReadOnlyNetwork(context, transferredBytes = () => 0) {
  await context.route("**/*", (route) => {
    const request = route.request();
    if (!allowedReadRequest(request.url(), request.method(), request.resourceType()) || transferredBytes() >= MAX_RUN_BYTES) {
      return route.abort();
    }
    return route.fallback();
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
}

async function visit(page, url) {
  const target = new URL(url);
  if (target.hostname !== "www.airbnb.co.za" || !/^\/(?:multicalendar\/\d+(?:\/reservation\/[A-Z0-9]{8,16})?|hosting\/messages(?:\/\d+)?)\/?$/.test(target.pathname)) {
    throw new ExtractionError("Browser navigation is outside the read-only allowlist");
  }
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  if (!response || response.status() >= 400) throw new ExtractionError("Airbnb page did not load");
  const current = new URL(page.url());
  if (current.hostname !== "www.airbnb.co.za" || /\/login|\/authenticate/.test(current.pathname)) throw new AuthExpiredError();
  try { await page.locator("body").waitFor({ state: "visible", timeout: 10_000 }); }
  catch { throw new ExtractionError("Airbnb host page did not render"); }
}

export async function withAirbnbBrowser(storageState, work, launch = chromium.launch.bind(chromium)) {
  if (!storageState?.cookies?.length) throw new AuthExpiredError();
  const browser = await launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  const deadline = setTimeout(() => { void browser.close(); }, MAX_RUN_MS);
  let context;
  let transferredBytes = 0;
  const responseReads = [];
  try {
    context = await browser.newContext({ storageState, locale: "en-ZA", timezoneId: "Africa/Johannesburg", serviceWorkers: "block" });
    context.setDefaultTimeout(7_000);
    context.on("response", (response) => {
      responseReads.push(response.body().then((body) => { transferredBytes += body.length; }).catch(() => {}));
    });
    await installReadOnlyNetwork(context, () => transferredBytes);
    const result = await work({ context, visit });
    let responseDeadline;
    try {
      await Promise.race([
        Promise.allSettled(responseReads),
        new Promise((_resolve, reject) => { responseDeadline = setTimeout(() => reject(new ExtractionError("Browser responses did not finish")), 10_000); }),
      ]);
    } finally { clearTimeout(responseDeadline); }
    if (transferredBytes > MAX_RUN_BYTES) throw new ExtractionError("Browser transfer limit exceeded");
    return { data: result, auth: await context.storageState(), transferredBytes };
  } catch (error) {
    let responseDeadline;
    try {
      await Promise.race([
        Promise.allSettled(responseReads),
        new Promise((resolve) => { responseDeadline = setTimeout(resolve, 2_000); }),
      ]);
    } finally { clearTimeout(responseDeadline); }
    error.transferredBytes = transferredBytes;
    throw error;
  } finally {
    clearTimeout(deadline);
    await context?.close();
    await browser.close();
  }
}

export async function readCalendars(config, storageState, launch) {
  return withAirbnbBrowser(storageState, ({ context, visit: navigate }) => scanCalendars(context, config, navigate), launch);
}

export async function scanCalendars(context, config, navigate = visit, now = new Date()) {
    const listings = [];
    const seenCodes = new Map();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", day: "2-digit" }).formatToParts(now);
    const today = `${monthKey(now)}-${parts.find((part) => part.type === "day").value}`;
    for (const listing of LISTINGS) {
      const page = await context.newPage();
      try {
        const calendarUrl = config.calendarUrls[listing.unitNumber];
        await navigate(page, calendarUrl);
        try { await page.locator('[role="grid"][aria-label]').nth(2).waitFor({ state: "attached", timeout: 10_000 }); }
        catch { throw new ExtractionError("Three-month calendar did not render"); }
        const { months, barTargets } = await extractCalendarViewport(page, listing.name, today);
        if (barTargets.length > MAX_RESERVATIONS) throw new ExtractionError("Reservation scan limit exceeded");
        const reservations = [];
        for (const { selector, summary } of barTargets) {
          await navigate(page, calendarUrl);
          const bar = page.locator(`[data-testid="reservation-bar"][data-selector="${selector}"]`).first();
          await bar.waitFor({ state: "visible", timeout: 10_000 });
          await bar.click();
          await page.waitForURL(/\/multicalendar\/\d+\/reservation\/[A-Z0-9]{8,16}\/?$/, { timeout: 7_000 });
          await page.locator('#hosting-details-reservation-info-row-confirmation-code-row-title').waitFor({ state: "visible", timeout: 7_000 });
          const route = new URL(page.url()).pathname;
          if (!route.startsWith(`${new URL(calendarUrl).pathname}/reservation/`)) throw new ExtractionError("Reservation belongs to another listing");
          const reservation = await extractReservation(page, listing, summary);
          const previous = seenCodes.get(reservation.confirmationCode);
          if (previous && JSON.stringify(previous) !== JSON.stringify(reservation)) throw new ExtractionError("Conflicting booking code details");
          seenCodes.set(reservation.confirmationCode, reservation);
          if (!previous) reservations.push(reservation);
        }
        listings.push({ unitNumber: listing.unitNumber, listingName: listing.name, months, reservations });
      } finally { await page.close(); }
    }
    return { source: "airbnb_host_website", listings };
}

export async function readMessages(config, storageState, launch) {
  return withAirbnbBrowser(storageState, ({ context, visit: navigate }) => scanMessages(context, config, navigate), launch);
}

export async function scanMessages(context, config, navigate = visit) {
    const inbox = await context.newPage();
    try {
      await navigate(inbox, config.messagesUrl);
      const collected = new Set();
      let stable = 0;
      for (let index = 0; index < 8; index += 1) {
        const next = await extractInbox(inbox);
        const before = collected.size;
        for (const url of next) collected.add(url);
        stable = collected.size === before ? stable + 1 : 0;
        if (collected.size > MAX_THREADS) throw new ExtractionError("Message scan limit exceeded");
        if (stable >= 2) break;
        await inbox.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          for (const element of document.querySelectorAll("*")) {
            if (element.scrollHeight > element.clientHeight + 10) element.scrollTop = element.scrollHeight;
          }
        });
        await inbox.waitForTimeout(300);
      }
      if (stable < 2) throw new ExtractionError("Message list did not finish loading");
      const threads = [];
      for (const url of collected) {
        const page = await context.newPage();
        try {
          await navigate(page, url);
          const messages = new Map();
          let stableHistory = 0;
          let thread;
          for (let index = 0; index < 8; index += 1) {
            thread = await extractThread(page, url);
            const before = messages.size;
            for (const message of thread.messages) {
              const prior = messages.get(message.id);
              if (prior && JSON.stringify(prior) !== JSON.stringify(message)) throw new ExtractionError("Conflicting message history");
              messages.set(message.id, message);
            }
            if (messages.size > 100) throw new ExtractionError("Message history scan limit exceeded");
            stableHistory = messages.size === before ? stableHistory + 1 : 0;
            if (stableHistory >= 2) break;
            await page.evaluate(() => {
              window.scrollTo(0, 0);
              for (const row of document.querySelectorAll('[data-testid="message-row"], article[data-message-id]')) {
                let parent = row.parentElement;
                while (parent) { if (parent.scrollHeight > parent.clientHeight + 10) parent.scrollTop = 0; parent = parent.parentElement; }
              }
            });
            await page.waitForTimeout(300);
          }
          if (stableHistory < 2) throw new ExtractionError("Message history did not finish loading");
          threads.push({ ...thread, messages: [...messages.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)) });
        } finally { await page.close(); }
      }
      return { source: "airbnb_host_website", threads };
    } finally { await inbox.close(); }
}
