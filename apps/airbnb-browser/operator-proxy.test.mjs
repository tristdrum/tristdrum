import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createLocalOperatorProxy, provisionOperatorToken, readOneTimePassphraseFromTTY,
  readOperatorToken } from "./operator-proxy.mjs";

test("TTY capability prompt disables echo and never writes the entered value", async () => {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  const rawModes = [];
  stdin.setRawMode = (enabled) => { stdin.isRaw = enabled; rawModes.push(enabled); };
  let output = "";
  const stdout = { isTTY: true, write: (chunk) => { output += chunk; } };
  const secret = "SYNTHETIC_Capability_2026_!";
  const reading = readOneTimePassphraseFromTTY({ stdin, stdout });
  stdin.emit("data", Buffer.from(`${secret}\r`));
  const capability = await reading;
  assert.equal(capability.toString(), secret);
  assert.deepEqual(rawModes, [true, false]);
  assert.equal(output.includes(secret), false);
  capability.fill(0);
  assert.equal(capability.toString().includes(secret), false);
  await assert.rejects(readOneTimePassphraseFromTTY({ stdin: {}, stdout }), /TTY/);
});

test("owner-only local token is staged to scoped Fly via stdin without a token argument", async () => {
  const dir = await mkdtemp(join(tmpdir(), "airbnb-operator-test-"));
  const path = join(dir, "operator-token");
  const calls = [];
  const fakeSpawn = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    let input = "";
    child.stdin.on("data", (chunk) => { input += chunk; });
    child.stdin.on("end", () => { calls.push({ binary, args, input }); setImmediate(() => child.emit("exit", 0)); });
    if (options.stdio[0] === "ignore") setImmediate(() => { calls.push({ binary, args, input: null }); child.emit("exit", 0); });
    return child;
  };
  try {
    const result = await provisionOperatorToken({ path, spawnProcess: fakeSpawn, flyBin: "/Users/tristdrum/.local/bin/fly-personal" });
    const token = await readOperatorToken(path);
    assert.deepEqual(result, { staged: true, path });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].args, ["auth", "whoami"]);
    assert.deepEqual(calls[1].args, ["status", "--app", "tristdrum-airbnb-browser-pilot"]);
    assert.deepEqual(calls[2].args, ["secrets", "import", "--app", "tristdrum-airbnb-browser-pilot", "--stage"]);
    assert.equal(calls[2].input, `AIRBNB_BROWSER_OPERATOR_TOKEN=${token}\n`);
    assert.equal(calls[2].args.join(" ").includes(token), false);
    await chmod(path, 0o644);
    await assert.rejects(readOperatorToken(path), /owner-only/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Mac loopback proxy requires Basic on every path, strips it upstream, and expires", async () => {
  const token = "o".repeat(40);
  const capability = "SYNTHETIC_Capability_2026_!";
  const correct = `Basic ${Buffer.from(`operator:${capability}`).toString("base64")}`;
  const wrong = `Basic ${Buffer.from("operator:synthetic-wrong-value").toString("base64")}`;
  const wrongUser = `Basic ${Buffer.from(`other:${capability}`).toString("base64")}`;
  let clock = 1_000;
  const received = [];
  const upstream = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push({ path: request.url, auth: request.headers.authorization,
        proxyAuth: request.headers["proxy-authorization"], cookie: request.headers.cookie, body });
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const local = createLocalOperatorProxy({ upstreamPort: upstream.address().port, token,
    capability, ttlMs: 5_000, now: () => clock }).listen(0, "127.0.0.1");
  await once(local, "listening");
  const base = `http://127.0.0.1:${local.address().port}`;
  try {
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await fetch(`${base}/ui.js`, { headers: { Authorization: wrong } })).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: wrong } })).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: wrongUser } })).status, 401);
    assert.equal(received.length, 0);
    assert.equal((await fetch(`${base}/`, { headers: { Authorization: correct } })).status, 200);
    assert.equal(received[0].auth, undefined);
    assert.equal(received[0].proxyAuth, undefined);
    assert.equal(received[0].cookie, undefined);
    const response = await fetch(`${base}/api/input`, { method: "POST",
      headers: { "Content-Type": "application/json", Origin: base, Authorization: correct,
        "Proxy-Authorization": "synthetic-proxy-credential", Cookie: "synthetic-cookie" },
      body: JSON.stringify({ kind: "text", text: "SYNTHETIC_INPUT" }) });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(received[1].auth, `Bearer ${token}`);
    assert.equal(received[1].proxyAuth, undefined);
    assert.equal(received[1].cookie, undefined);
    assert.match(received[1].body, /SYNTHETIC_INPUT/);
    assert.equal((await fetch(`${base}/api/status?token=synthetic`, { headers: { Authorization: correct } })).status, 403);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: correct, Origin: "https://evil.example" } })).status, 403);
    assert.equal(received.length, 2);
    clock = 6_001;
    assert.equal((await fetch(`${base}/`, { headers: { Authorization: correct } })).status, 410);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: correct } })).status, 410);
    assert.equal(received.length, 2);
  } finally {
    await new Promise((resolve) => local.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
