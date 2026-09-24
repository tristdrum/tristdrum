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

export async function extractCalendarViewport(page, listingName, today) {
  const raw = await page.evaluate((name) => {
    const grids = [...document.querySelectorAll('[role="grid"][aria-label]')].map((grid) => ({
      heading: grid.getAttribute("aria-label"),
      cells: [...grid.querySelectorAll('[role="gridcell"] button[data-date]')].map((button) => {
        const described = document.getElementById(button.getAttribute("aria-describedby") ?? "");
        return { date: button.getAttribute("data-date"), disabled: button.disabled,
          description: described?.textContent ?? "", text: button.innerText };
      }),
    }));
    const bars = [...document.querySelectorAll('[data-testid="reservation-bar"]')]
      .map((bar) => ({ selector: bar.getAttribute("data-selector"), summary: bar.textContent?.trim() }))
      .filter((bar) => /^reservation-bar-\d{4}-\d{2}-\d{2}$/.test(bar.selector ?? "") && bar.summary);
    return { listingSelected: document.title.includes(name), grids, bars };
  }, listingName);
  if (!raw.listingSelected || raw.grids.length !== 3) throw new ExtractionError("Three-month calendar layout or listing identity changed");
  const months = [];
  for (const grid of raw.grids) {
    const match = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/.exec(grid.heading ?? "");
    if (!match) throw new ExtractionError("Calendar month heading changed");
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const year = Number(match[2]);
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const days = new Map();
    for (const cell of grid.cells) {
      if (!cell.date?.startsWith(`${key}-`)) continue;
      const date = isoDate(cell.date);
      const description = cell.description.toLowerCase();
      const status = /\breservation\b/.test(description) ? "reserved" :
        /blocked|unavailable|closed/.test(description) ? "blocked" :
          cell.disabled && date < today ? "past" :
            !cell.disabled && !description && /nightly price/i.test(cell.text) ? "available" : null;
      if (!status || days.has(date)) throw new ExtractionError("Calendar day status is missing or duplicated");
      days.set(date, status);
    }
    if (days.size !== new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new ExtractionError("Calendar month is incomplete");
    months.push({ month: key, days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, status]) => ({ date, status })) });
  }
  for (let index = 1; index < months.length; index += 1) {
    const expected = new Date(`${months[index - 1].month}-01T00:00:00Z`);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    if (months[index].month !== expected.toISOString().slice(0, 7)) throw new ExtractionError("Calendar months are not consecutive");
  }
  if (!months.some(({ month }) => month === today.slice(0, 7))) throw new ExtractionError("Current SAST month is not visible");
  if (months.some((month) => month.days.some((day) => day.status === "reserved")) && !raw.bars.length) {
    throw new ExtractionError("Reserved nights lack reservation bars");
  }
  const uniqueBars = new Map();
  for (const bar of raw.bars) if (!uniqueBars.has(bar.summary)) uniqueBars.set(bar.summary, bar);
  return { months, barTargets: [...uniqueBars.values()] };
}

export async function extractReservation(page, listing, barSummary) {
  const route = new URL(page.url());
  const match = /^\/multicalendar\/(\d+)\/reservation\/([A-Z0-9]{8,16})\/?$/.exec(route.pathname);
  if (route.hostname !== "www.airbnb.co.za" || !match) throw new ExtractionError("Reservation detail route changed");
  const dates = /Checkin on ([A-Za-z]{3,9} \d{1,2},? \d{4}), checkout on ([A-Za-z]{3,9} \d{1,2},? \d{4})\./i.exec(barSummary ?? "");
  if (!dates) throw new ExtractionError("Reservation bar dates are missing");
  const raw = await page.evaluate(() => {
    const label = document.getElementById("hosting-details-reservation-info-row-confirmation-code-row-title");
    const profileIds = [...document.querySelectorAll('a[href*="/users/profile/"]')]
      .filter((link) => link.getClientRects().length > 0 && getComputedStyle(link).visibility !== "hidden")
      .map((link) => { const url = new URL(link.href); return url.hostname === "www.airbnb.co.za" ? /^\/users\/profile\/(\d+)\/?$/.exec(url.pathname)?.[1] : null; })
      .filter(Boolean);
    return { title: document.title, code: /\b[A-Z0-9]{8,16}\b/.exec(label?.nextElementSibling?.textContent ?? "")?.[0] ?? null,
      guestName: document.querySelector('[data-testid="guestFirstName"]')?.textContent?.trim() ?? null,
      guestProfileId: [...new Set(profileIds)].length === 1 ? profileIds[0] : null };
  });
  const code = match[2];
  if (!raw.title.includes(listing.name) || raw.code !== code || !raw.guestName) {
    throw new ExtractionError("Reservation code or guest detail is incomplete");
  }
  const checkIn = isoDate(dates[1]);
  const checkOut = isoDate(dates[2]);
  if (checkIn >= checkOut) throw new ExtractionError("Reservation date order is invalid");
  return { confirmationCode: code, unitNumber: listing.unitNumber, listingName: listing.name,
    guestName: raw.guestName, guestProfileId: raw.guestProfileId, checkIn, checkOut,
    status: "calendar_reservation" };
}

export async function extractInbox(page) {
  const raw = await page.evaluate(() => ({
    hasHeading: [...document.querySelectorAll("h1, h2")].some((node) => /messages/i.test(node.textContent ?? "")),
    hasList: Boolean(document.querySelector('#list_inbox[aria-label="List of Conversations"]')),
    empty: Boolean(document.querySelector('[data-testid="empty-inbox"]')),
    ids: [...document.querySelectorAll('#list_inbox [data-testid^="inbox_list_"]')]
      .map((node) => /^inbox_list_(\d+)$/.exec(node.getAttribute("data-testid") ?? "")?.[1]).filter(Boolean),
    more: Boolean(document.querySelector('[aria-label*="Load more"], [aria-label*="Next page"], [data-testid="load-more"]')),
  }));
  if (!raw.hasHeading || !raw.hasList || (!raw.empty && !raw.ids.length) || raw.more) {
    throw new ExtractionError("Messages inbox layout or pagination changed");
  }
  return [...new Set(raw.ids)].map((id) => `https://www.airbnb.co.za/hosting/messages/${id}`);
}

export async function extractThread(page, url) {
  if (await page.locator('[data-testid="message-list"]').count()) {
    throw new ExtractionError("Airbnb message sender, timestamp and history structure need live calibration");
  }
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
