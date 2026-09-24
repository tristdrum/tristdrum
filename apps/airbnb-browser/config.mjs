import { resolve } from "node:path";

export const LISTINGS = Object.freeze([
  { unitNumber: 1, name: "Bougainvillea Courtyard Studio" },
  { unitNumber: 2, name: "The Spekboom Studio" },
  { unitNumber: 3, name: "Jasmine Studio Stay" },
]);

export const MAX_AGE_MS = Object.freeze({ messages: 5 * 60_000, calendar: 15 * 60_000 });

export function airbnbUrl(value, pathPrefix) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.airbnb.co.za" ||
      url.username || url.password || url.hash || url.search || !url.pathname.startsWith(pathPrefix) ||
      !/^\/(?:multicalendar\/\d+|hosting\/messages)\/?$/.test(url.pathname)) {
    throw new Error("Expected an HTTPS Airbnb hosting URL");
  }
  return url.href;
}

export function loadConfig(env = process.env) {
  const dataKey = Buffer.from(env.AIRBNB_BROWSER_DATA_KEY ?? "", "base64");
  if (dataKey.length !== 32 || !/^[A-Za-z0-9+/]{43}=$/.test(env.AIRBNB_BROWSER_DATA_KEY ?? "")) {
    throw new Error("AIRBNB_BROWSER_DATA_KEY must be 32 random bytes in base64");
  }
  const mcpToken = env.AIRBNB_BROWSER_MCP_TOKEN ?? "";
  if (mcpToken.length < 32) throw new Error("AIRBNB_BROWSER_MCP_TOKEN must be at least 32 characters");
  const operatorToken = env.AIRBNB_BROWSER_OPERATOR_TOKEN ?? "";
  if (operatorToken.length < 32 || operatorToken === mcpToken) {
    throw new Error("AIRBNB_BROWSER_OPERATOR_TOKEN must be distinct and at least 32 characters");
  }
  let urls;
  try { urls = JSON.parse(env.AIRBNB_BROWSER_CALENDAR_URLS ?? ""); }
  catch { throw new Error("AIRBNB_BROWSER_CALENDAR_URLS must be JSON for units 1, 2 and 3"); }
  const calendarUrls = Object.fromEntries(LISTINGS.map(({ unitNumber }) => {
    if (typeof urls?.[unitNumber] !== "string") throw new Error(`Missing calendar URL for unit ${unitNumber}`);
    return [unitNumber, airbnbUrl(urls[unitNumber], "/multicalendar/")];
  }));
  return Object.freeze({
    dataKey,
    mcpToken,
    operatorToken,
    calendarUrls,
    messagesUrl: airbnbUrl(env.AIRBNB_BROWSER_MESSAGES_URL ?? "https://www.airbnb.co.za/hosting/messages", "/hosting/messages"),
    statePath: resolve(env.AIRBNB_BROWSER_STATE_PATH ?? "/data/browser-state.enc"),
    port: Number(env.PORT ?? 3000),
  });
}
