import { randomBytes } from "node:crypto";
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

export function createLocalOperatorProxy({ upstreamPort, token }) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || !/^[A-Za-z0-9_-]{40,}$/.test(token ?? "")) {
    throw new Error("Operator proxy configuration is invalid");
  }
  return createServer((incoming, outgoing) => {
    const host = incoming.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host) ||
        !incoming.url.startsWith("/") || incoming.url.startsWith("//") || incoming.url.includes("?") ||
        !["/", "/ui.js"].includes(incoming.url) && !incoming.url.startsWith("/api/") ||
        incoming.headers.origin && incoming.headers.origin !== `http://${host}`) {
      outgoing.writeHead(403).end();
      return;
    }
    const headers = { ...incoming.headers, host, connection: "close" };
    delete headers.authorization;
    delete headers["proxy-authorization"];
    delete headers.cookie;
    if (incoming.url.startsWith("/api/")) headers.authorization = `Bearer ${token}`;
    const upstream = httpRequest({ hostname: "127.0.0.1", port: upstreamPort, method: incoming.method,
      path: incoming.url, headers }, (response) => {
      const responseHeaders = { ...response.headers };
      delete responseHeaders["set-cookie"];
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502).end(); else outgoing.destroy(); });
    incoming.pipe(upstream);
  });
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
  spawnProcess = spawn, localPort = 3101 } = {}) {
  const token = await readOperatorToken(path);
  await runScopedFly(["auth", "whoami"], { spawnProcess, flyBin });
  await runScopedFly(["status", "--app", APP], { spawnProcess, flyBin });
  const tunnelPort = await unusedLocalPort();
  const tunnel = spawnProcess(flyBin, ["proxy", `${tunnelPort}:3001`, "--app", APP,
    "--bind-addr", "127.0.0.1"], { stdio: ["ignore", "ignore", "ignore"] });
  const server = createLocalOperatorProxy({ upstreamPort: tunnelPort, token });
  tunnel.once("exit", () => { if (server.listening) server.close(); });
  try {
    await waitForPrivateUI(tunnelPort, tunnel);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(localPort, "127.0.0.1", resolve); });
    return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      tunnel.kill("SIGTERM");
    } };
  } catch {
    tunnel.kill("SIGTERM");
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
      const local = await startLocalOperatorProxy();
      process.stdout.write(`Open ${local.url} in the personal browser. Close this process when finished.\n`);
      for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void local.close(); });
    } else throw new Error("Use provision or serve");
  } catch {
    process.stderr.write("Operator proxy action failed; no credential was displayed.\n");
    process.exitCode = 1;
  }
}
