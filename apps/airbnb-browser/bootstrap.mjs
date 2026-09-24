import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { chromium } from "playwright";
import { persistFreshCloudLogin } from "./auth-state.mjs";
import { allowedBootstrapRequest, installBootstrapNavigationGate, startBootstrapEgressProxy,
  validateAuthPostUrls } from "./bootstrap-network.mjs";

const TTL_MS = 10 * 60_000;
const MAX_INPUT_ACTIONS = 300;
const MAX_FRAMES = 1200;
const UI = readFileSync(new URL("./bootstrap-ui.html", import.meta.url), "utf8");
const UI_SCRIPT = readFileSync(new URL("./bootstrap-ui.js", import.meta.url), "utf8");

export class BootstrapController {
  constructor(service, { launch = chromium.launch.bind(chromium), proxyFactory = startBootstrapEgressProxy,
    gateFactory = installBootstrapNavigationGate, now = () => Date.now(), setTimer = setTimeout,
    clearTimer = clearTimeout, setPoll = setInterval, clearPoll = clearInterval,
    ttlMs = TTL_MS, env = process.env, authPostUrls = [] } = {}) {
    this.service = service;
    this.launch = launch;
    this.proxyFactory = proxyFactory;
    this.gateFactory = gateFactory;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.setPoll = setPoll;
    this.clearPoll = clearPoll;
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new Error("Invalid bootstrap TTL");
    this.ttlMs = Math.min(ttlMs, TTL_MS);
    this.env = env;
    this.authPostUrls = validateAuthPostUrls(authPostUrls);
    this.session = null;
    this.starting = false;
    this.closing = null;
    this.lastOutcome = null;
  }

  status() {
    return { active: Boolean(this.session), expiresAt: this.session?.expiresAt ?? null,
      outcome: this.lastOutcome };
  }

  #active() {
    if (!this.session || this.now() >= this.session.expiresAt) {
      if (this.session) void this.stop();
      throw new Error("session_unavailable");
    }
    return this.session;
  }

  async #rejectChallenge(session) {
    if (await session.page.locator('iframe[src*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]').count()) {
      await this.stop();
      throw new Error("session_unavailable");
    }
  }

  async #signedIn(session) {
    let path;
    try { path = new URL(session.page.url()).pathname; } catch { return false; }
    if (path !== "/hosting") return false;
    return await session.page.locator('a[href*="/calendar-router"]').count() > 0 &&
      await session.page.locator('a[href*="/hosting/messages"]').count() > 0 &&
      await session.page.locator('a[href*="/users/profile/about"]').count() > 0;
  }

  async #captureSignedIn(session) {
    if (this.session !== session || session.capturePromise || session.locked) return session.capturePromise;
    if (!await this.#signedIn(session)) return null;
    if (this.session !== session || session.capturePromise || this.now() >= session.expiresAt) return null;
    session.locked = true;
    session.capturePromise = (async () => {
      try {
        if (await session.page.locator('iframe[src*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]').count()) {
          throw new Error("challenge_detected");
        }
        await persistFreshCloudLogin(session.context, this.service, this.env, { signal: session.captureAbort.signal });
        if (session.captureAbort.signal.aborted) throw new Error("Browser auth capture cancelled");
        this.lastOutcome = "saved";
      } catch { if (!session.captureAbort.signal.aborted) this.lastOutcome = "unavailable"; }
      finally { await this.#closeSession(session); }
    })();
    return session.capturePromise;
  }

  async start() {
    if (this.session || this.starting || this.closing) throw new Error("session_active");
    this.starting = true;
    this.lastOutcome = null;
    let acquired = false;
    let proxy; let browser; let context; let page; let removeGate;
    const typedValues = new Set();
    try {
      await this.service.beginBootstrap();
      acquired = true;
      proxy = await this.proxyFactory();
      browser = await this.launch({ headless: true, proxy: { server: proxy.url },
        args: ["--disable-quic", "--disable-dev-shm-usage"] });
      context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block",
        locale: "en-ZA", timezoneId: "Africa/Johannesburg", viewport: { width: 1280, height: 800 } });
      page = await context.newPage();
      context.on("page", (opened) => { if (opened !== page) void opened.close().catch(() => {}); });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame() && !allowedBootstrapRequest(frame.url(), "GET", "Document")) void this.stop();
      });
      removeGate = await this.gateFactory(context, page, {
        policy: (url, method, type) => allowedBootstrapRequest(url, method, type, this.authPostUrls) &&
          ![...typedValues].some((value) => url.includes(value) || url.includes(encodeURIComponent(value))),
        onBlock: () => { void this.stop(); },
      });
      const expiresAt = this.now() + this.ttlMs;
      const session = { proxy, browser, context, page, removeGate, typedValues, expiresAt, actions: 0, frames: 0,
        timer: this.setTimer(() => { void this.stop(); }, this.ttlMs), poll: null,
        inputQueue: Promise.resolve(), locked: false, capturePromise: null, captureAbort: new AbortController() };
      this.session = session;
      await page.goto("https://www.airbnb.co.za/hosting", { waitUntil: "domcontentloaded", timeout: 20_000 });
      await this.#captureSignedIn(session);
      if (this.session === session) {
        session.poll = this.setPoll(() => { void this.#captureSignedIn(session).catch(() => this.stop()); }, 250);
      }
      return this.status();
    } catch {
      if (this.session) await this.stop();
      else {
        await Promise.allSettled([removeGate?.(), context?.close(), browser?.close(), proxy?.close()]);
        if (acquired) await this.service.endBootstrap();
      }
      throw new Error("bootstrap_unavailable");
    } finally { this.starting = false; }
  }

  async frame() {
    const session = this.#active();
    await this.#rejectChallenge(session);
    if (session.locked) throw new Error("session_unavailable");
    await this.#captureSignedIn(session);
    if (session.locked) throw new Error("session_unavailable");
    if (++session.frames > MAX_FRAMES) { await this.stop(); throw new Error("session_unavailable"); }
    return session.page.screenshot({ type: "jpeg", quality: 75, animations: "disabled", timeout: 5_000 });
  }

  async input(action) {
    const session = this.#active();
    if (++session.actions > MAX_INPUT_ACTIONS) { await this.stop(); throw new Error("session_unavailable"); }
    const run = async () => {
      this.#active();
      await this.#rejectChallenge(session);
      if (session.locked) throw new Error("session_unavailable");
      await this.#captureSignedIn(session);
      if (session.locked) throw new Error("session_unavailable");
      if (action?.kind === "click" && Number.isInteger(action.x) && Number.isInteger(action.y) &&
          action.x >= 0 && action.x < 1280 && action.y >= 0 && action.y < 800) {
        await session.page.mouse.click(action.x, action.y);
      } else if (action?.kind === "text" && typeof action.text === "string" && action.text.length > 0 && action.text.length <= 256) {
        session.typedValues.add(action.text);
        await session.page.keyboard.insertText(action.text);
      } else if (action?.kind === "key" && ["Enter", "Tab", "Shift+Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"].includes(action.key)) {
        await session.page.keyboard.press(action.key);
      } else throw new Error("invalid_input");
      await this.#captureSignedIn(session);
    };
    const result = session.inputQueue.then(run);
    session.inputQueue = result.catch(() => {});
    await result;
    return { ok: true };
  }

  async #closeSession(session) {
    if (this.closing) return this.closing;
    if (this.session !== session) return;
    this.session = null;
    session.locked = true;
    session.typedValues.clear();
    this.clearTimer(session.timer);
    if (session.poll !== null) this.clearPoll(session.poll);
    this.closing = (async () => {
      await Promise.allSettled([session.removeGate?.(), session.context.close(), session.browser.close(), session.proxy.close()]);
      await this.service.endBootstrap();
    })();
    try { await this.closing; } finally { this.closing = null; }
  }

  async stop() {
    const session = this.session;
    if (!session) return this.closing;
    session.captureAbort.abort();
    this.lastOutcome = "cancelled";
    return this.#closeSession(session);
  }
}

function operatorAuthorized(request, token) {
  const supplied = request.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const a = Buffer.from(supplied); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBootstrapApp(controller, operatorToken) {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.set({ "Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'" });
    const host = request.get("host") ?? "";
    if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || request.url.includes("?")) return response.sendStatus(403);
    if (request.get("origin") && request.get("origin") !== `http://${host}`) return response.sendStatus(403);
    next();
  });
  app.get("/", (_request, response) => response.type("html").send(UI));
  app.get("/ui.js", (_request, response) => response.type("application/javascript").send(UI_SCRIPT));
  app.use("/api", express.json({ limit: "1kb" }), (request, response, next) => {
    if (!operatorAuthorized(request, operatorToken)) return response.sendStatus(401);
    next();
  });
  app.get("/api/status", (_request, response) => response.json(controller.status()));
  app.post("/api/start", async (_request, response) => {
    try { response.json(await controller.start()); }
    catch { response.status(409).json({ error: "session_unavailable" }); }
  });
  app.get("/api/frame", async (_request, response) => {
    try { response.type("jpeg").send(await controller.frame()); }
    catch { response.status(410).json({ error: "session_unavailable" }); }
  });
  app.post("/api/input", async (request, response) => {
    try { response.json(await controller.input(request.body)); }
    catch { response.status(400).json({ error: "input_unavailable" }); }
  });
  app.post("/api/stop", async (_request, response) => { await controller.stop(); response.json({ stopped: true }); });
  app.use((error, _request, response, _next) => { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); });
  return app;
}
