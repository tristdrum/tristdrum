import { chromium } from "playwright";
import { LISTINGS } from "./config.mjs";
import { monthKey } from "./budget.mjs";
import { ExtractionError, extractCalendarMonth, extractInbox, extractReservation, extractThread } from "./extract.mjs";

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
    (parsed.hostname === "airbnb.com" || parsed.hostname.endsWith(".airbnb.com") ||
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
  if (target.hostname !== "www.airbnb.com" || !/^\/hosting\/(?:calendar(?:\/[A-Za-z0-9-]+)?|messages(?:\/\d+)?|reservations\/details\/[A-Za-z0-9-]+)\/?$/.test(target.pathname)) {
    throw new ExtractionError("Browser navigation is outside the read-only allowlist");
  }
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  if (!response || response.status() >= 400) throw new ExtractionError("Airbnb page did not load");
  const current = new URL(page.url());
  if (current.hostname !== "www.airbnb.com" || /\/login|\/authenticate/.test(current.pathname)) throw new AuthExpiredError();
  await page.locator("body").waitFor({ state: "visible", timeout: 10_000 });
}

async function revealConfirmationCode(page) {
  if (await page.getByText(/^confirmation code$/i).first().isVisible()) return;
  const options = page.locator('button[aria-label="More options"], button[aria-label="More"], button[data-testid="reservation-options"]');
  if (await options.count() !== 1) throw new ExtractionError("Reservation code control changed");
  await options.click();
  await page.getByText(/^confirmation code$/i).first().waitFor({ state: "visible", timeout: 7_000 });
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
    for (const listing of LISTINGS) {
      const page = await context.newPage();
      try {
        await navigate(page, config.calendarUrls[listing.unitNumber]);
        const months = [];
        const reservationUrls = new Set();
        for (let index = 0; index < 3; index += 1) {
          const month = await extractCalendarMonth(page, listing.name);
          if (index === 0 && month.month !== monthKey(now)) throw new ExtractionError("Calendar does not start with the current SAST month");
          if (months.length) {
            const previous = months.at(-1).month;
            const expected = new Date(`${previous}-01T00:00:00Z`);
            expected.setUTCMonth(expected.getUTCMonth() + 1);
            if (month.month !== expected.toISOString().slice(0, 7)) throw new ExtractionError("Calendar navigation skipped a month");
          }
          months.push({ month: month.month, days: month.days });
          for (const url of month.reservationUrls) reservationUrls.add(url);
          if (index < 2) {
            const next = page.getByRole("button", { name: /^next month$/i });
            if (await next.count() !== 1) throw new ExtractionError("Calendar next-month control changed");
            const oldHeading = await page.evaluate(() => [...document.querySelectorAll('[data-testid="calendar-month"], h2, h3')]
              .map((node) => node.textContent?.trim()).find((text) => /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(text ?? "")));
            await next.click();
            await page.waitForFunction((previous) => [...document.querySelectorAll('[data-testid="calendar-month"], h2, h3')]
              .map((node) => node.textContent?.trim()).some((text) =>
                /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(text ?? "") && text !== previous),
            oldHeading, { timeout: 7_000 });
          }
        }
        if (reservationUrls.size > MAX_RESERVATIONS) throw new ExtractionError("Reservation scan limit exceeded");
        const reservations = [];
        for (const url of reservationUrls) {
          const detail = await context.newPage();
          try {
            await navigate(detail, url);
            await revealConfirmationCode(detail);
            const reservation = await extractReservation(detail, listing);
            const previous = seenCodes.get(reservation.confirmationCode);
            if (previous && JSON.stringify(previous) !== JSON.stringify(reservation)) throw new ExtractionError("Conflicting booking code details");
            seenCodes.set(reservation.confirmationCode, reservation);
            reservations.push(reservation);
          } finally { await detail.close(); }
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
