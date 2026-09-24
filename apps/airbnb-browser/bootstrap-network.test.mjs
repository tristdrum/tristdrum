import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { allowedBootstrapHost, allowedBootstrapRequest, installBootstrapNavigationGate, startBootstrapEgressProxy,
  validateAuthPostUrls } from "./bootstrap-network.mjs";

test("bootstrap permits only Airbnb-owned HTTPS hosts and narrow document paths", () => {
  assert.equal(allowedBootstrapHost("www.airbnb.co.za"), true);
  assert.equal(allowedBootstrapHost("a0.muscache.com"), true);
  assert.equal(allowedBootstrapHost("airbnb.co.za.evil.example"), false);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/login", "GET", "Document"), true);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/hosting", "GET", "Document"), true);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/hosting/messages", "GET", "Document"), false);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/login?otp=123456", "GET", "Document"), false);
  assert.equal(allowedBootstrapRequest("http://www.airbnb.co.za/login", "GET", "Document"), false);
  assert.equal(allowedBootstrapRequest("https://accounts.google.com/login", "GET", "Document"), false);
});

test("bootstrap POSTs require an exact reviewed auth endpoint and reject guest actions", () => {
  const authUrl = "https://www.airbnb.co.za/api/v2/auth/synthetic-mfa";
  const reviewed = validateAuthPostUrls([authUrl]);
  assert.equal(allowedBootstrapRequest(authUrl, "POST", "XHR", reviewed), true);
  assert.equal(allowedBootstrapRequest(authUrl, "POST", "XHR"), false);
  assert.equal(allowedBootstrapRequest(`${authUrl}?state=synthetic`, "POST", "XHR", reviewed), false);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/api/v2/auth/unknown", "POST", "XHR", reviewed), false);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/api/v2/messages/send", "POST", "XHR", reviewed), false);
  assert.equal(allowedBootstrapRequest("https://www.airbnb.co.za/multicalendar/101/reservation/SYNTHETIC", "POST", "XHR", reviewed), false);
  assert.throws(() => validateAuthPostUrls(["https://www.airbnb.co.za/api/v2/messages/send"]), /reviewed/);
  assert.throws(() => validateAuthPostUrls(["https://www.airbnb.co.za/api/v2/auth/messages"]), /reviewed/);
  assert.throws(() => validateAuthPostUrls(["https://www.airbnb.co.za/api/v2/auth/send-message"]), /reviewed/);
  assert.throws(() => validateAuthPostUrls(["https://www.airbnb.co.za/api/v2/auth/synthetic-mfa?token=synthetic"]), /reviewed/);
});

test("private egress proxy refuses offsite CONNECT before contacting it", async () => {
  const proxy = await startBootstrapEgressProxy();
  const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1");
  try {
    await once(socket, "connect");
    socket.write("CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n\r\n");
    const [chunk] = await once(socket, "data");
    assert.match(chunk.toString("utf8"), /^HTTP\/1\.1 403 Forbidden/);
  } finally { socket.destroy(); await proxy.close(); }
});

test("CDP gate sees a redirect request before a disallowed second hop is sent", async () => {
  const seen = [];
  const local = createServer((request, response) => {
    seen.push(request.url);
    if (request.url === "/start") response.writeHead(302, { Location: "/forbidden" }).end();
    else response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>unexpected</h1>");
  }).listen(0, "127.0.0.1");
  await once(local, "listening");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let blocked = false;
    await installBootstrapNavigationGate(context, page, {
      policy: (url, _method, type) => type !== "Document" || new URL(url).pathname === "/start",
      onBlock: () => { blocked = true; },
    });
    await assert.rejects(page.goto(`http://127.0.0.1:${local.address().port}/start`, { timeout: 5_000 }));
    assert.deepEqual(seen, ["/start"]);
    assert.equal(blocked, true);
  } finally { await browser.close(); local.close(); await once(local, "close"); }
});

test("CDP gate blocks a synthetic guest-action POST before it reaches the server", async () => {
  const seen = [];
  const local = createServer((request, response) => {
    seen.push([request.method, request.url]);
    if (request.url === "/login") {
      response.writeHead(200, { "Content-Type": "text/html" }).end(
        "<script>fetch('/api/v2/messages/send',{method:'POST',body:'synthetic'}).catch(()=>{}).finally(()=>window.postSettled=true)</script>");
    } else response.writeHead(200).end("unexpected");
  }).listen(0, "127.0.0.1");
  await once(local, "listening");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installBootstrapNavigationGate(context, page, {
      policy: (url, method, type) => allowedBootstrapRequest(
        `https://www.airbnb.co.za${new URL(url).pathname}`, method, type,
        ["https://www.airbnb.co.za/api/v2/auth/synthetic-mfa"]),
    });
    await page.goto(`http://127.0.0.1:${local.address().port}/login`);
    await page.waitForFunction(() => window.postSettled === true);
    assert.deepEqual(seen, [["GET", "/login"]]);
  } finally { await browser.close(); local.close(); await once(local, "close"); }
});
