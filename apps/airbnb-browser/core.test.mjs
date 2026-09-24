import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addRuntime, addTransfer, budgetStatus, currentBudget, reserveEventModelCost } from "./budget.mjs";
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
    AIRBNB_BROWSER_OPERATOR_TOKEN: "y".repeat(32),
    AIRBNB_BROWSER_CALENDAR_URLS: JSON.stringify({
      1: "https://www.airbnb.co.za/multicalendar/101",
      2: "https://www.airbnb.co.za/multicalendar/102",
      3: "https://www.airbnb.co.za/multicalendar/103",
    }),
  };
  assert.equal(loadConfig(env).calendarUrls[3], "https://www.airbnb.co.za/multicalendar/103");
  assert.equal(loadConfig(env).bootstrapEnabled, false);
  const bootstrap = loadConfig({ ...env, AIRBNB_BROWSER_BOOTSTRAP_ENABLED: "true" });
  assert.equal(bootstrap.bootstrapHost, "fly-local-6pn");
  assert.equal(bootstrap.bootstrapPort, 3001);
  assert.throws(() => loadConfig({ ...env, AIRBNB_BROWSER_OPERATOR_TOKEN: env.AIRBNB_BROWSER_MCP_TOKEN }), /distinct/);
  assert.throws(() => loadConfig({ ...env, AIRBNB_BROWSER_CALENDAR_URLS: JSON.stringify({
    1: "https://evil.example/multicalendar/101", 2: env.AIRBNB_BROWSER_MESSAGES_URL, 3: "https://www.airbnb.co.za/multicalendar/103",
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
  const valid = { cookies: [{ domain: ".airbnb.co.za", name: "session", value: "synthetic" }], origins: [{ origin: "https://www.airbnb.co.za", localStorage: [] }] };
  assert.equal(validateStorageState(valid), valid);
  assert.throws(() => validateStorageState({ ...valid, cookies: [{ ...valid.cookies[0], domain: ".evil.example" }] }));
  assert.throws(() => validateStorageState({ ...valid, origins: [{ origin: "https://evil.example" }] }));
  const state = {};
  const service = { saveFreshCloudLogin: async (browser) => { state.auth = validateStorageState(await browser.storageState()); state.snapshots = {}; } };
  const context = { storageState: async () => valid };
  await assert.rejects(persistFreshCloudLogin(context, service, {}), /inside the pilot Fly app/);
  await persistFreshCloudLogin(context, service, { FLY_APP_NAME: "tristdrum-airbnb-browser-pilot" });
  assert.equal(state.auth, valid);
  assert.deepEqual(state.snapshots, {});
});

test("browser requests have a fixed read-only host and method boundary", () => {
  assert.equal(allowedReadRequest("https://www.airbnb.co.za/multicalendar/101", "GET", "document"), true);
  assert.equal(allowedReadRequest("https://a0.muscache.com/app.js", "GET", "script"), true);
  assert.equal(allowedReadRequest("https://www.airbnb.co.za/api", "POST", "fetch"), false);
  assert.equal(allowedReadRequest("https://evil.example/", "GET", "document"), false);
  assert.equal(allowedReadRequest("https://www.airbnb.co.za/photo.jpg", "GET", "image"), false);
});

test("monthly meter resets, caps transfer and gates future event costs", () => {
  const now = new Date("2026-09-24T00:00:00Z");
  const budget = currentBudget({}, now);
  assert.equal(budgetStatus(budget, now).limitUsd, 10);
  assert.equal(budgetStatus(budget, now).worstCaseComputeReserveUsd, 7.5);
  assert.equal(budgetStatus(budget, now).worstCaseCommittedUsd, 9.25);
  assert.equal(budgetStatus(budget, now).modelCapacityUsd, 0.7);
  const running = addRuntime(budget, 3600, now);
  assert.equal(budgetStatus(running, now).runtimeUsd, 0.01);
  assert.equal(budgetStatus(running, now).reservedVolumeRootfsSnapshotsUsd, 1);
  const nearCap = addTransfer(budget, 2 * 1024 ** 3, now);
  assert.equal(budgetStatus(nearCap, now).exhausted, true);
  assert.equal(currentBudget(nearCap, new Date("2026-09-30T21:59:59Z")).transferredBytes, 2 * 1024 ** 3);
  assert.equal(currentBudget(nearCap, new Date("2026-09-30T22:00:00Z")).transferredBytes, 0);
  assert.equal(currentBudget(nearCap, new Date("2026-10-01T00:00:00Z")).transferredBytes, 0);
  assert.equal(reserveEventModelCost(budget, 0.7, now).modelUsd, 0.7);
  assert.throws(() => reserveEventModelCost(budget, 0.71, now), /budget exhausted/);
});

test("Fly config keeps one Machine polling while the login UI remains a private unmapped port", async () => {
  const fly = await readFile(new URL("./fly.toml", import.meta.url), "utf8");
  assert.match(fly, /^\s*auto_stop_machines = "stop"\s*$/m);
  assert.match(fly, /^\s*auto_start_machines = true\s*$/m);
  assert.match(fly, /^\s*min_machines_running = 1\s*$/m);
  assert.match(fly, /^\s*memory_mb = 1024\s*$/m);
  assert.match(fly, /^\s*internal_port = 3000\s*$/m);
  assert.doesNotMatch(fly, /internal_port\s*=\s*3001/);
});

test("all future Airbnb action types refuse in the pilot", async () => {
  for (const action of [
    { type: "send_message", threadId: "1", body: "hello" },
    { type: "set_calendar_day", unitNumber: 1, date: "2026-09-24", available: false },
    { type: "modify_reservation", confirmationCode: "TESTCODE1", checkIn: "2026-09-24", checkOut: "2026-09-25" },
    { type: "cancel_reservation", confirmationCode: "TESTCODE1" },
  ]) assert.deepEqual(await performAirbnbAction(action), { accepted: false, reason: "READ_ONLY_PILOT" });
});
