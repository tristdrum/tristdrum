import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";
import { BootstrapController, createBootstrapApp } from "./bootstrap.mjs";
import { createLocalOperatorProxy } from "./operator-proxy.mjs";

function fakeBootstrap({ ttlMs = 5_000, saveFailure = false } = {}) {
  const calls = { begin: 0, end: 0, saved: null, input: [], gatePolicy: null };
  let clock = 1_000;
  let expiry;
  let poll;
  let signedIn = false;
  const auth = { cookies: [{ domain: ".airbnb.co.za", name: "synthetic", value: "fixture" }], origins: [] };
  const page = {
    goto: async () => {},
    url: () => "https://www.airbnb.co.za/hosting",
    on: () => {}, mainFrame: () => ({}),
    screenshot: async () => Buffer.from("synthetic-frame"),
    locator: (selector) => ({ count: async () => selector.startsWith("iframe") ? 0 : Number(signedIn),
      first: () => ({ waitFor: async () => {} }) }),
    mouse: { click: async (x, y) => calls.input.push(["click", x, y]) },
    keyboard: { insertText: async (value) => calls.input.push(["text", value]),
      press: async (value) => calls.input.push(["key", value]) },
  };
  const context = { newPage: async () => page, on: () => {}, close: async () => {}, storageState: async () => auth };
  const browser = { newContext: async (options) => { assert.equal(options.storageState, undefined); return context; }, close: async () => {} };
  const service = {
    beginBootstrap: async () => { calls.begin += 1; },
    endBootstrap: async () => { calls.end += 1; },
    saveFreshCloudLogin: async (savedContext) => {
      if (saveFailure) throw new Error("synthetic_save_failure");
      calls.saved = await savedContext.storageState();
    },
  };
  const controller = new BootstrapController(service, {
    launch: async (options) => { assert.match(options.proxy.server, /^http:\/\/127\.0\.0\.1:/); return browser; },
    proxyFactory: async () => ({ url: "http://127.0.0.1:9999", close: async () => {} }),
    gateFactory: async (_context, _page, options) => { calls.gatePolicy = options.policy; return async () => {}; },
    now: () => clock,
    setTimer: (callback) => { expiry = callback; return 1; },
    clearTimer: () => {},
    setPoll: (callback) => { poll = callback; return 2; },
    clearPoll: () => { poll = null; },
    ttlMs,
    env: { FLY_APP_NAME: "tristdrum-airbnb-browser-pilot" },
    authPostUrls: ["https://www.airbnb.co.za/api/v2/auth/synthetic-mfa"],
  });
  return { controller, calls, page, setClock: (value) => { clock = value; }, expire: () => expiry?.(),
    poll: () => poll?.(), setSignedIn: (value) => { signedIn = value; } };
}

test("bootstrap uses one fresh context, bounded input, and in-memory auth save", async () => {
  const { controller, calls, setSignedIn, poll } = fakeBootstrap();
  const started = await controller.start();
  assert.equal(started.active, true);
  assert.equal(started.expiresAt, 6_000);
  await assert.rejects(controller.start(), /session_active/);
  assert.equal((await controller.frame()).toString(), "synthetic-frame");
  assert.deepEqual(await controller.input({ kind: "text", text: "SYNTHETIC_INPUT" }), { ok: true });
  assert.equal(calls.gatePolicy("https://www.airbnb.co.za/login?state=SYNTHETIC_INPUT", "GET", "Document"), false);
  assert.equal(calls.gatePolicy("https://www.airbnb.co.za/login?state=ok", "GET", "Document"), true);
  assert.equal(calls.gatePolicy("https://www.airbnb.co.za/api/v2/messages/send", "POST", "XHR"), false);
  assert.equal(calls.gatePolicy("https://www.airbnb.co.za/api/v2/auth/synthetic-mfa", "POST", "XHR"), true);
  await controller.input({ kind: "click", x: 100, y: 200 });
  await controller.input({ kind: "key", key: "Enter" });
  await assert.rejects(controller.input({ kind: "key", key: "Meta+R" }), /invalid_input/);
  assert.deepEqual(calls.input, [["text", "SYNTHETIC_INPUT"], ["click", 100, 200], ["key", "Enter"]]);
  setSignedIn(true);
  poll();
  for (let i = 0; i < 20 && !calls.saved; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(calls.saved.cookies[0].domain, ".airbnb.co.za");
  assert.equal(calls.end, 1);
  assert.equal(controller.status().active, false);
  assert.equal(controller.status().outcome, "saved");
  await assert.rejects(controller.input({ kind: "click", x: 1, y: 1 }), /session_unavailable/);
});

test("bootstrap TTL closes the only active session without saving", async () => {
  const { controller, calls, setClock, expire } = fakeBootstrap();
  await controller.start();
  setClock(6_001);
  expire();
  await controller.stop();
  assert.equal(controller.status().active, false);
  assert.equal(calls.saved, null);
  assert.equal(calls.end, 1);
  await assert.rejects(controller.frame(), /session_unavailable/);
});

test("automatic capture failure closes without claiming a saved sign-in", async () => {
  const { controller, calls, setSignedIn, poll } = fakeBootstrap({ saveFailure: true });
  await controller.start();
  setSignedIn(true);
  poll();
  for (let i = 0; i < 20 && controller.status().active; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(controller.status().active, false);
  assert.equal(controller.status().outcome, "unavailable");
  assert.equal(calls.saved, null);
  assert.equal(calls.end, 1);
});

test("detected CAPTCHA iframe and missing signed-in navigation never save auth", async () => {
  const challenged = fakeBootstrap();
  await challenged.controller.start();
  challenged.page.locator = () => ({ count: async () => 1 });
  await assert.rejects(challenged.controller.frame(), /session_unavailable/);
  assert.equal(challenged.controller.status().active, false);
  assert.equal(challenged.calls.saved, null);

  const unverified = fakeBootstrap();
  await unverified.controller.start();
  unverified.poll();
  await unverified.controller.frame();
  assert.equal(unverified.calls.saved, null);
  await unverified.controller.stop();
});

test("private UI requires operator bearer and never echoes typed input", async () => {
  const calls = [];
  const controller = { status: () => ({ active: false, expiresAt: null }),
    start: async () => ({ active: true, expiresAt: 2_000 }),
    input: async (action) => { calls.push(action.kind); return { ok: true }; },
    frame: async () => Buffer.from("synthetic-frame"),
    stop: async () => {} };
  const server = createBootstrapApp(controller, "o".repeat(40)).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const operator = { Authorization: `Bearer ${"o".repeat(40)}` };
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${"m".repeat(40)}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: { ...operator, Origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(`${base}/api/status?secret=synthetic`, { headers: operator })).status, 403);
    const response = await fetch(`${base}/api/input`, { method: "POST", headers: { ...operator, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "text", text: "SYNTHETIC_INPUT" }) });
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, ["text"]);
  } finally { server.close(); await once(server, "close"); }
});

test("owner UI holds no token and clears synthetic OTP before its POST completes", async () => {
  const token = "o".repeat(40);
  let releaseInput;
  let received = null;
  let resolveReceived;
  const receivedPromise = new Promise((resolve) => { resolveReceived = resolve; });
  const controller = { status: () => ({ active: false, expiresAt: null }),
    start: async () => ({ active: true, expiresAt: Date.now() + 60_000 }),
    frame: async () => Buffer.from("synthetic-frame"),
    input: async (action) => { received = action; resolveReceived(action);
      await new Promise((resolve) => { releaseInput = resolve; }); return { ok: true }; },
    stop: async () => {} };
  const cloud = createBootstrapApp(controller, token).listen(0, "127.0.0.1");
  await once(cloud, "listening");
  const capability = "SYNTHETIC_Capability_2026_!";
  const local = createLocalOperatorProxy({ upstreamPort: cloud.address().port, token, capability }).listen(0, "127.0.0.1");
  await once(local, "listening");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ httpCredentials: { username: "operator", password: capability } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${local.address().port}/`);
    assert.equal(await page.locator("#operator").count(), 0);
    await page.getByRole("button", { name: "Start" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator("#entry").fill("SYNTHETIC_OTP");
    await page.getByRole("button", { name: "Type" }).click();
    await page.waitForFunction(() => document.querySelector("#entry")?.value === "");
    assert.equal(await page.locator("#entry").inputValue(), "");
    await receivedPromise;
    assert.deepEqual(received, { kind: "text", text: "SYNTHETIC_OTP" });
    releaseInput();
  } finally {
    if (releaseInput) releaseInput();
    await browser.close();
    await new Promise((resolve) => local.close(resolve));
    await new Promise((resolve) => cloud.close(resolve));
  }
});
