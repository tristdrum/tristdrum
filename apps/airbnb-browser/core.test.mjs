import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addTransfer, budgetStatus, currentBudget, reserveEventModelCost } from "./budget.mjs";
import { allowedReadRequest } from "./browser.mjs";
import { loadConfig } from "./config.mjs";
import { EncryptedStore, decryptJson, encryptJson } from "./encrypted-store.mjs";
import { persistFreshCloudLogin, validateStorageState } from "./auth-state.mjs";
import { performAirbnbAction } from "./actions.mjs";

const key = randomBytes(32);

test("configuration fixes the three listing URLs and rejects foreign hosts", () => {
  const env = {
    AIRBNB_BROWSER_DATA_KEY: key.toString("base64"),
    AIRBNB_BROWSER_MCP_TOKEN: "x".repeat(32),
    AIRBNB_BROWSER_CALENDAR_URLS: JSON.stringify({
      1: "https://www.airbnb.com/hosting/calendar?listingId=1",
      2: "https://www.airbnb.com/hosting/calendar?listingId=2",
      3: "https://www.airbnb.com/hosting/calendar?listingId=3",
    }),
  };
  assert.equal(loadConfig(env).calendarUrls[3], "https://www.airbnb.com/hosting/calendar?listingId=3");
  assert.throws(() => loadConfig({ ...env, AIRBNB_BROWSER_CALENDAR_URLS: JSON.stringify({
    1: "https://evil.example/hosting/calendar", 2: env.AIRBNB_BROWSER_MESSAGES_URL, 3: "https://www.airbnb.com/hosting/calendar",
  }) }), /Airbnb hosting URL/);
});

test("state and guest snapshots are encrypted and tampering fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "airbnb-browser-test-"));
  try {
    const path = join(dir, "state.enc");
    const store = new EncryptedStore(path, key);
    await store.write({ marker: "SYNTHETIC_PRIVATE_MARKER", auth: { cookies: ["synthetic-cookie"] } });
    const bytes = await readFile(path, "utf8");
    assert.doesNotMatch(bytes, /SYNTHETIC_PRIVATE_MARKER|synthetic-cookie/);
    assert.deepEqual(await store.read(), { marker: "SYNTHETIC_PRIVATE_MARKER", auth: { cookies: ["synthetic-cookie"] } });
    const malformed = JSON.parse(bytes);
    malformed.ciphertext = Buffer.from("bad").toString("base64");
    assert.throws(() => decryptJson(JSON.stringify(malformed), key));
    assert.notEqual(encryptJson({ value: 1 }, key), encryptJson({ value: 1 }, key));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("in-memory cloud login capture accepts only Airbnb-owned state", async () => {
  const valid = { cookies: [{ domain: ".airbnb.com", name: "session", value: "secret" }], origins: [{ origin: "https://www.airbnb.com", localStorage: [] }] };
  assert.equal(validateStorageState(valid), valid);
  assert.throws(() => validateStorageState({ ...valid, cookies: [{ ...valid.cookies[0], domain: ".evil.example" }] }));
  assert.throws(() => validateStorageState({ ...valid, origins: [{ origin: "https://evil.example" }] }));
  const state = {};
  const store = { read: async () => state, write: async (value) => Object.assign(state, value) };
  const context = { storageState: async () => valid };
  await assert.rejects(persistFreshCloudLogin(context, store, {}), /inside the pilot Fly app/);
  await persistFreshCloudLogin(context, store, { FLY_APP_NAME: "tristdrum-airbnb-browser-pilot" });
  assert.equal(state.auth, valid);
  assert.deepEqual(state.snapshots, {});
});

test("browser requests have a fixed read-only host and method boundary", () => {
  assert.equal(allowedReadRequest("https://www.airbnb.com/hosting/calendar", "GET", "document"), true);
  assert.equal(allowedReadRequest("https://a0.muscache.com/app.js", "GET", "script"), true);
  assert.equal(allowedReadRequest("https://www.airbnb.com/api", "POST", "fetch"), false);
  assert.equal(allowedReadRequest("https://evil.example/", "GET", "document"), false);
  assert.equal(allowedReadRequest("https://www.airbnb.com/photo.jpg", "GET", "image"), false);
});

test("monthly meter resets, caps transfer and gates future event costs", () => {
  const now = new Date("2026-09-24T00:00:00Z");
  const budget = currentBudget({}, now);
  assert.equal(budgetStatus(budget, now).limitUsd, 10);
  const nearCap = addTransfer(budget, 2 * 1024 ** 3, now);
  assert.equal(budgetStatus(nearCap, now).exhausted, true);
  assert.equal(currentBudget(nearCap, new Date("2026-09-30T21:59:59Z")).transferredBytes, 2 * 1024 ** 3);
  assert.equal(currentBudget(nearCap, new Date("2026-09-30T22:00:00Z")).transferredBytes, 0);
  assert.equal(currentBudget(nearCap, new Date("2026-10-01T00:00:00Z")).transferredBytes, 0);
  assert.throws(() => reserveEventModelCost(budget, 2, now), /budget exhausted/);
});

test("all future Airbnb action types refuse in the pilot", async () => {
  for (const action of [
    { type: "send_message", threadId: "1", body: "hello" },
    { type: "set_calendar_day", unitNumber: 1, date: "2026-09-24", available: false },
    { type: "modify_reservation", confirmationCode: "TESTCODE1", checkIn: "2026-09-24", checkOut: "2026-09-25" },
    { type: "cancel_reservation", confirmationCode: "TESTCODE1" },
  ]) assert.deepEqual(await performAirbnbAction(action), { accepted: false, reason: "READ_ONLY_PILOT" });
});
