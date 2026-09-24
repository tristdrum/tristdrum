import { LISTINGS } from "./config.mjs";

export class ExtractionError extends Error {
  constructor(reason) { super(reason); this.name = "ExtractionError"; }
}

const MONTHS = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
});

export function isoDate(value) {
  const text = String(value ?? "").trim();
  let year; let month; let day;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) [, year, month, day] = iso;
  else {
    const human = /^(?:(\d{1,2})\s+([A-Za-z]{3,9})|([A-Za-z]{3,9})\s+(\d{1,2})),?\s+(\d{4})$/.exec(text);
    if (!human) throw new ExtractionError("Unparseable reservation date");
    year = human[5];
    month = MONTHS[(human[2] ?? human[3]).slice(0, 3).toLowerCase()];
    day = human[1] ?? human[4];
  }
  const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) {
    throw new ExtractionError("Invalid reservation date");
  }
  return result;
}

export async function extractCalendarMonth(page, listing) {
  const raw = await page.evaluate((name) => {
    const selected = [...document.querySelectorAll('[data-testid="selected-listing"], [aria-current="page"], h1, h2')]
      .map((node) => node.textContent?.trim()).filter(Boolean);
    const heading = [...document.querySelectorAll('[data-testid="calendar-month"], h2, h3')]
      .map((node) => node.textContent?.trim()).find((value) => /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(value));
    const cells = [...document.querySelectorAll('[data-date], [role="gridcell"][aria-label]')].map((node) => ({
      date: node.getAttribute("data-date")?.slice(0, 10) ?? node.getAttribute("datetime")?.slice(0, 10) ??
        /\b\d{4}-\d{2}-\d{2}\b/.exec(node.getAttribute("aria-label") ?? "")?.[0] ?? null,
      status: node.getAttribute("data-status") ?? node.getAttribute("aria-label") ?? node.textContent ?? "",
    }));
    const reservationUrls = [...document.querySelectorAll('a[href*="/hosting/reservations/"]')]
      .map((node) => node.href).filter((href) => /^\/hosting\/reservations\/details\/[A-Za-z0-9-]+\/?$/.test(new URL(href).pathname));
    return { listingSelected: selected.some((value) => value === name), heading, cells, reservationUrls };
  }, listing);
  if (!raw.listingSelected || !raw.heading || raw.cells.length < 28) {
    throw new ExtractionError("Calendar layout or listing identity changed");
  }
  const monthMatch = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i.exec(raw.heading);
  const month = MONTHS[monthMatch[1].slice(0, 3).toLowerCase()];
  const year = Number(monthMatch[2]);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const days = new Map();
  for (const cell of raw.cells) {
    if (!cell.date?.startsWith(`${monthKey}-`)) continue;
    const date = isoDate(cell.date);
    const source = cell.status.toLowerCase();
    const status = /reserved|booked/.test(source) ? "reserved" :
      /blocked|unavailable/.test(source) ? "blocked" : /available/.test(source) ? "available" : null;
    if (!status || (days.has(date) && days.get(date) !== status)) throw new ExtractionError("Unknown or conflicting calendar day status");
    days.set(date, status);
  }
  const expectedDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (days.size !== expectedDays) throw new ExtractionError("Calendar month is incomplete");
  const reservationUrls = [...new Set(raw.reservationUrls)];
  if ([...days.values()].includes("reserved") && !reservationUrls.length) {
    throw new ExtractionError("Reserved nights lack reservation detail links");
  }
  for (const url of reservationUrls) {
    if (new URL(url).hostname !== "www.airbnb.com") throw new ExtractionError("Unexpected reservation URL");
  }
  return { month: monthKey, days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, status]) => ({ date, status })), reservationUrls };
}

async function labeledValues(page) {
  return page.evaluate(() => {
    const result = {};
    for (const label of document.querySelectorAll("dt, th, [data-testid='detail-label']")) {
      const key = label.textContent?.trim().toLowerCase().replace(/[:\s]+/g, " ");
      const sibling = label.nextElementSibling;
      if (key && sibling) result[key] = sibling.textContent?.trim();
    }
    return { labels: result, body: document.body.innerText };
  });
}

function field(raw, labels, fallback) {
  for (const label of labels) if (raw.labels[label]) return raw.labels[label];
  return fallback?.exec(raw.body)?.[1]?.trim() ?? null;
}

export async function extractReservation(page, listing) {
  const raw = await labeledValues(page);
  const guestProfileId = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('a[data-testid="guest-profile-link"], a[aria-label*="guest profile" i], [data-testid="guest-details"] a[href*="/users/"]')]
      .filter((link) => link.getClientRects().length > 0 && getComputedStyle(link).visibility !== "hidden")
      .map((link) => {
        const url = new URL(link.href);
        if (url.hostname !== "www.airbnb.com") return null;
        return /^\/users\/(?:show|profile)\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
      }).filter(Boolean);
    const distinct = [...new Set(candidates)];
    return distinct.length === 1 ? distinct[0] : null;
  });
  const code = field(raw, ["confirmation code"], /Confirmation code\s*[:\n]\s*([A-Z0-9]{8,16})/i)?.toUpperCase();
  const checkInText = field(raw, ["check-in", "check in"], /Check[- ]in\s*[:\n]\s*([^\n]+)/i);
  const checkOutText = field(raw, ["checkout", "check-out", "check out"], /Check[- ]out\s*[:\n]\s*([^\n]+)/i);
  const guestName = field(raw, ["guest", "guest name"], /Guest(?: name)?\s*[:\n]\s*([^\n]+)/i);
  const listingName = field(raw, ["listing"], /Listing\s*[:\n]\s*([^\n]+)/i);
  const status = field(raw, ["status"], /Status\s*[:\n]\s*([^\n]+)/i)?.toLowerCase();
  if (!/^[A-Z0-9]{8,16}$/.test(code ?? "") || !guestName || listingName !== listing.name ||
      !["confirmed", "pending", "cancelled", "canceled"].includes(status)) {
    throw new ExtractionError("Reservation detail is incomplete or mismatched");
  }
  const checkIn = isoDate(checkInText);
  const checkOut = isoDate(checkOutText);
  if (checkIn >= checkOut) throw new ExtractionError("Reservation date order is invalid");
  return { confirmationCode: code, unitNumber: listing.unitNumber, listingName, guestName, guestProfileId,
    checkIn, checkOut, status: status === "canceled" ? "cancelled" : status };
}

export async function extractInbox(page) {
  const raw = await page.evaluate(() => ({
    hasHeading: [...document.querySelectorAll("h1, h2")].some((node) => /messages/i.test(node.textContent ?? "")),
    empty: Boolean(document.querySelector('[data-testid="empty-inbox"]')),
    links: [...document.querySelectorAll('a[href*="/hosting/messages/"]')].map((node) => node.href)
      .filter((href) => /\/hosting\/messages\/\d+\/?$/.test(new URL(href).pathname)),
    more: Boolean(document.querySelector('[aria-label*="Load more"], [aria-label*="Next page"], [data-testid="load-more"]')),
  }));
  if (!raw.hasHeading || (!raw.empty && !raw.links.length) || raw.more) {
    throw new ExtractionError("Messages inbox layout or pagination changed");
  }
  const links = [...new Set(raw.links)];
  if (links.some((href) => new URL(href).hostname !== "www.airbnb.com")) throw new ExtractionError("Unexpected message URL");
  return links;
}

export async function extractThread(page, url) {
  const raw = await page.evaluate(() => {
    const listingName = document.querySelector('[data-testid="thread-listing"]')?.textContent?.trim() ??
      [...document.querySelectorAll("h1, h2")].map((node) => node.textContent?.trim())
        .find((text) => ["Bougainvillea Courtyard Studio", "The Spekboom Studio", "Jasmine Studio Stay"].includes(text));
    const messages = [...document.querySelectorAll('[data-testid="message-row"], article[data-message-id]')].map((node) => ({
      id: node.getAttribute("data-message-id") ?? node.getAttribute("data-testid-id"),
      sender: node.getAttribute("data-sender") ?? node.querySelector('[data-testid="sender"]')?.textContent?.trim(),
      sentAt: node.querySelector("time[datetime]")?.getAttribute("datetime"),
      body: node.querySelector('[data-testid="message-body"]')?.textContent?.trim() ?? node.querySelector("p")?.textContent?.trim(),
    }));
    return { listingName, messages, empty: Boolean(document.querySelector('[data-testid="empty-thread"]')),
      more: Boolean(document.querySelector('[aria-label*="Load earlier"], [data-testid="load-earlier"]')) };
  });
  const listing = LISTINGS.find(({ name }) => name === raw.listingName);
  if (!listing || raw.more || (!raw.empty && !raw.messages.length) || raw.messages.length > 100) {
    throw new ExtractionError("Message thread layout or listing identity changed");
  }
  const messages = raw.messages.map((message) => {
    const sentAt = new Date(message.sentAt ?? "");
    if (!message.id || !message.sender || !message.body || message.body.length > 4000 || !Number.isFinite(sentAt.getTime())) {
      throw new ExtractionError("Message entry is incomplete");
    }
    return { id: message.id, sender: message.sender, sentAt: sentAt.toISOString(), body: message.body };
  });
  const threadId = /\/hosting\/messages\/(\d+)/.exec(new URL(url).pathname)?.[1];
  if (!threadId) throw new ExtractionError("Invalid message thread URL");
  return { threadId, unitNumber: listing.unitNumber, listingName: listing.name, messages };
}
