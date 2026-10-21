import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const APP = "tristdrum-airbnb-browser-pilot";
const FLY_PERSONAL = "/Users/tristdrum/.local/bin/fly-personal";
const DEFAULT_FILE = join(homedir(), ".config", "airbnb-browser-pilot", "operator-token");
const LOCAL_TTL_MS = 15 * 60_000;

export async function readOneTimePassphraseFromTTY({ stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("An interactive TTY is required for the local capability");
  }
  const previousRaw = Boolean(stdin.isRaw);
  const bytes = [];
  stdout.write("One-time local capability (24-128 mixed ASCII characters): ");
  stdin.setRawMode(true);
  stdin.resume();
  try {
    return await new Promise((resolve, reject) => {
      function cleanup() { stdin.off("data", onData); stdin.off("error", onError); }
      function onError() { cleanup(); reject(new Error("Local capability input unavailable")); }
      function onData(chunk) {
        for (const byte of chunk) {
          if (byte === 3) { cleanup(); reject(new Error("Local capability input cancelled")); return; }
          if (byte === 127 || byte === 8) { bytes.pop(); continue; }
          if (byte === 13 || byte === 10) {
            cleanup();
            const value = Buffer.from(bytes);
            const text = value.toString("ascii");
            const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(text)).length;
            if (value.length < 24 || value.length > 128 || classes < 3) {
              value.fill(0);
              reject(new Error("Local capability must be 24-128 mixed ASCII characters"));
            } else resolve(value);
            return;
          }
          if (byte < 32 || byte > 126 || bytes.length >= 128) {
            cleanup(); reject(new Error("Local capability input is invalid")); return;
          }
          bytes.push(byte);
        }
      }
      stdin.on("data", onData);
      stdin.on("error", onError);
    });
  } finally {
    bytes.fill(0);
    stdin.setRawMode(previousRaw);
    stdin.pause();
    stdout.write("\n");
  }
}

export async function readOperatorToken(path = DEFAULT_FILE) {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
    throw new Error("Operator token file must be owner-only and not a symlink");
  }
  const token = (await readFile(path, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) throw new Error("Operator token file is invalid");
  return token;
}

async function runScopedFly(args, { input = null, spawnProcess = spawn, flyBin = FLY_PERSONAL } = {}) {
  const child = spawnProcess(flyBin, args, { stdio: [input === null ? "ignore" : "pipe", "ignore", "ignore"] });
  if (input !== null) child.stdin.end(input);
  let timeout;
  let code;
  try {
    [code] = await Promise.race([
      once(child, "exit"),
      new Promise((_resolve, reject) => { timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Scoped Fly operation timed out")); }, 30_000); }),
    ]);
  } finally { clearTimeout(timeout); }
  if (code !== 0) throw new Error("Scoped Fly operation failed");
}

export async function provisionOperatorToken({ path = DEFAULT_FILE, spawnProcess = spawn, flyBin = FLY_PERSONAL } = {}) {
  await runScopedFly(["auth", "whoami"], { spawnProcess, flyBin });
  await runScopedFly(["status", "--app", APP], { spawnProcess, flyBin });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(path));
  if (!directory.isDirectory() || (process.getuid && directory.uid !== process.getuid())) {
    throw new Error("Operator token directory must be owner-controlled");
  }
  await chmod(dirname(path), 0o700);
  if (!existsSync(path)) await writeFile(path, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  const token = await readOperatorToken(path);
  await runScopedFly(["secrets", "import", "--app", APP, "--stage"], {
    input: `AIRBNB_BROWSER_OPERATOR_TOKEN=${token}\n`, spawnProcess, flyBin,
  });
  return { staged: true, path };
}

export function createLocalOperatorProxy({ upstreamPort, token, capability, ttlMs = LOCAL_TTL_MS,
  now = () => Date.now() }) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || !/^[A-Za-z0-9_-]{40,}$/.test(token ?? "")) {
    throw new Error("Operator proxy configuration is invalid");
  }
  const secret = Buffer.isBuffer(capability) ? capability : Buffer.from(capability ?? "");
  if (secret.length < 24 || secret.length > 128 || !Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > LOCAL_TTL_MS) {
    throw new Error("Local capability or TTL is invalid");
  }
  const expectedHash = createHash("sha256").update(secret).digest();
  const expiresAt = now() + ttlMs;
  return createServer((incoming, outgoing) => {
    outgoing.setHeader("Cache-Control", "no-store");
    const authorization = incoming.headers.authorization ?? "";
    let authorized = false;
    if (/^Basic [A-Za-z0-9+/=]{1,512}$/.test(authorization)) {
      const decoded = Buffer.from(authorization.slice(6), "base64");
      const separator = decoded.indexOf(58);
      if (separator > 0) {
        const candidateHash = createHash("sha256").update(decoded.subarray(separator + 1)).digest();
        const usernameValid = decoded.subarray(0, separator).equals(Buffer.from("operator"));
        const capabilityValid = timingSafeEqual(candidateHash, expectedHash);
        authorized = usernameValid && capabilityValid;
        candidateHash.fill(0);
      }
      decoded.fill(0);
    }
    if (!authorized) {
      outgoing.writeHead(401, { "WWW-Authenticate": 'Basic realm="Airbnb private login"' }).end();
      return;
    }
    if (now() >= expiresAt) { outgoing.writeHead(410).end(); return; }
    const path = incoming.url ?? "";
    const host = incoming.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host) ||
        !path.startsWith("/") || path.startsWith("//") || path.includes("?") ||
        !["/", "/ui.js"].includes(path) && !path.startsWith("/api/") ||
        incoming.headers.origin && incoming.headers.origin !== `http://${host}`) {
      outgoing.writeHead(403).end();
      return;
    }
    const headers = { ...incoming.headers, host, connection: "close" };
    delete headers.authorization;
    delete headers["proxy-authorization"];
    delete headers.cookie;
    if (path.startsWith("/api/")) headers.authorization = `Bearer ${token}`;
    const upstream = httpRequest({ hostname: "127.0.0.1", port: upstreamPort, method: incoming.method,
      path, headers }, (response) => {
      const responseHeaders = { ...response.headers };
      delete responseHeaders["set-cookie"];
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502).end(); else outgoing.destroy(); });
    incoming.pipe(upstream);
  }).once("close", () => expectedHash.fill(0));
}

async function unusedLocalPort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForPrivateUI(port, tunnel) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (tunnel.exitCode !== null) throw new Error("Private Fly tunnel stopped");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch { /* tunnel has not reached the private UI yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Private Fly UI is unreachable");
}

export async function startLocalOperatorProxy({ path = DEFAULT_FILE, flyBin = FLY_PERSONAL,
  spawnProcess = spawn, localPort = 0, capability } = {}) {
  const token = await readOperatorToken(path);
  await runScopedFly(["auth", "whoami"], { spawnProcess, flyBin });
  await runScopedFly(["status", "--app", APP], { spawnProcess, flyBin });
  const tunnelPort = await unusedLocalPort();
  const tunnel = spawnProcess(flyBin, ["proxy", `${tunnelPort}:3001`, "--app", APP,
    "--bind-addr", "127.0.0.1"], { stdio: ["ignore", "ignore", "ignore"] });
  let server;
  let closed = false;
  let expiry;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(expiry);
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    tunnel.kill("SIGTERM");
  };
  try {
    server = createLocalOperatorProxy({ upstreamPort: tunnelPort, token, capability });
    tunnel.once("exit", () => { void close(); });
    await waitForPrivateUI(tunnelPort, tunnel);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(localPort, "127.0.0.1", resolve); });
    expiry = setTimeout(() => { void close(); }, LOCAL_TTL_MS);
    return { url: `http://127.0.0.1:${server.address().port}`, close };
  } catch {
    await close();
    throw new Error("Local operator proxy unavailable");
  }
}

if (process.argv[1]?.endsWith("operator-proxy.mjs")) {
  const command = process.argv[2];
  try {
    if (command === "provision") {
      await provisionOperatorToken();
      process.stdout.write("Operator token staged and saved in an owner-only local file. No value was displayed.\n");
    } else if (command === "serve") {
      const capability = await readOneTimePassphraseFromTTY();
      let local;
      try { local = await startLocalOperatorProxy({ capability }); }
      finally { capability.fill(0); }
      process.stdout.write(`Open ${local.url} in the personal browser. This local tunnel closes after 15 minutes.\n`);
      for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void local.close(); });
    } else throw new Error("Use provision or serve");
  } catch {
    process.stderr.write("Operator proxy action failed; no credential was displayed.\n");
    process.exitCode = 1;
  }
}
