import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { chromium } from "playwright";
import { persistFreshCloudLogin } from "./auth-state.mjs";
import { allowedBootstrapRequest, installBootstrapNavigationGate, startBootstrapEgressProxy } from "./bootstrap-network.mjs";

const TTL_MS = 10 * 60_000;
const MAX_INPUT_ACTIONS = 300;
const MAX_FRAMES = 1200;
const UI = readFileSync(new URL("./bootstrap-ui.html", import.meta.url), "utf8");
const UI_SCRIPT = readFileSync(new URL("./bootstrap-ui.js", import.meta.url), "utf8");

export class BootstrapController {
  constructor(service, { launch = chromium.launch.bind(chromium), proxyFactory = startBootstrapEgressProxy,
    gateFactory = installBootstrapNavigationGate, now = () => Date.now(), setTimer = setTimeout,
    clearTimer = clearTimeout, ttlMs = TTL_MS, env = process.env } = {}) {
    this.service = service;
    this.launch = launch;
    this.proxyFactory = proxyFactory;
    this.gateFactory = gateFactory;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new Error("Invalid bootstrap TTL");
    this.ttlMs = Math.min(ttlMs, TTL_MS);
    this.env = env;
    this.session = null;
    this.starting = false;
    this.closing = null;
  }

  status() {
    return { active: Boolean(this.session), expiresAt: this.session?.expiresAt ?? null };
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

  async start() {
    if (this.session || this.starting || this.closing) throw new Error("session_active");
    this.starting = true;
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
        policy: (url, method, type) => allowedBootstrapRequest(url, method, type) &&
          ![...typedValues].some((value) => url.includes(value) || url.includes(encodeURIComponent(value))),
        onBlock: () => { void this.stop(); },
      });
      const expiresAt = this.now() + this.ttlMs;
      this.session = { proxy, browser, context, page, removeGate, typedValues, expiresAt, actions: 0, frames: 0,
        timer: this.setTimer(() => { void this.stop(); }, this.ttlMs), inputQueue: Promise.resolve() };
      await page.goto("https://www.airbnb.co.za/hosting", { waitUntil: "domcontentloaded", timeout: 20_000 });
      return { active: true, expiresAt };
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
    if (++session.frames > MAX_FRAMES) { await this.stop(); throw new Error("session_unavailable"); }
    return session.page.screenshot({ type: "jpeg", quality: 75, animations: "disabled", timeout: 5_000 });
  }

  async input(action) {
    const session = this.#active();
    if (++session.actions > MAX_INPUT_ACTIONS) { await this.stop(); throw new Error("session_unavailable"); }
    const run = async () => {
      this.#active();
      await this.#rejectChallenge(session);
      if (await this.#signedIn(session)) throw new Error("sign_in_ready_to_finish");
      if (action?.kind === "click" && Number.isInteger(action.x) && Number.isInteger(action.y) &&
          action.x >= 0 && action.x < 1280 && action.y >= 0 && action.y < 800) {
        await session.page.mouse.click(action.x, action.y);
      } else if (action?.kind === "text" && typeof action.text === "string" && action.text.length > 0 && action.text.length <= 256) {
        session.typedValues.add(action.text);
        await session.page.keyboard.insertText(action.text);
      } else if (action?.kind === "key" && ["Enter", "Tab", "Shift+Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"].includes(action.key)) {
        await session.page.keyboard.press(action.key);
      } else throw new Error("invalid_input");
    };
    const result = session.inputQueue.then(run);
    session.inputQueue = result.catch(() => {});
    await result;
    return { ok: true };
  }

  async finish() {
    const session = this.#active();
    await session.inputQueue;
    try {
      await this.#rejectChallenge(session);
      await session.page.goto("https://www.airbnb.co.za/hosting", { waitUntil: "domcontentloaded", timeout: 15_000 });
      await session.page.locator('a[href*="/calendar-router"]').first().waitFor({ state: "visible", timeout: 5_000 });
      if (!await this.#signedIn(session)) {
        throw new Error("not_authenticated");
      }
      await persistFreshCloudLogin(session.context, this.service, this.env);
      await this.stop();
      return { saved: true };
    } catch {
      throw new Error("sign_in_not_verified");
    }
  }

  async stop() {
    if (this.closing) return this.closing;
    const session = this.session;
    this.session = null;
    if (!session) return;
    session.typedValues.clear();
    this.clearTimer(session.timer);
    this.closing = (async () => {
      await Promise.allSettled([session.removeGate?.(), session.context.close(), session.browser.close(), session.proxy.close()]);
      await this.service.endBootstrap();
    })();
    try { await this.closing; } finally { this.closing = null; }
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
  app.post("/api/finish", async (_request, response) => {
    try { response.json(await controller.finish()); }
    catch { response.status(409).json({ error: "sign_in_not_verified" }); }
  });
  app.post("/api/stop", async (_request, response) => { await controller.stop(); response.json({ stopped: true }); });
  app.use((error, _request, response, _next) => { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); });
  return app;
}
