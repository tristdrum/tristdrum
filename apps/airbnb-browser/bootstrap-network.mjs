import { createServer } from "node:http";
import { connect } from "node:net";

export function allowedBootstrapHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "airbnb.co.za" || host.endsWith(".airbnb.co.za") ||
    host === "airbnb.com" || host.endsWith(".airbnb.com") ||
    host === "muscache.com" || host.endsWith(".muscache.com");
}

export function allowedBootstrapRequest(value, method, resourceType) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !allowedBootstrapHost(url.hostname) || !["GET", "HEAD", "OPTIONS", "POST"].includes(method)) return false;
  if ([...url.searchParams.keys()].some((key) => /pass|otp|token|code|secret|credential|pin/i.test(key))) return false;
  if (resourceType === "Document" || resourceType === "document") {
    return url.hostname === "www.airbnb.co.za" &&
      (url.pathname === "/" || url.pathname === "/hosting" ||
        /^\/(?:login|signup|auth|authenticate|verify|verification|identity)(?:\/|$)/.test(url.pathname));
  }
  return true;
}

export async function installBootstrapNavigationGate(context, page, { policy = allowedBootstrapRequest, onBlock = () => {} } = {}) {
  const cdp = await context.newCDPSession(page);
  cdp.on("Fetch.requestPaused", (event) => {
    let allowed = false;
    try { allowed = policy(event.request.url, event.request.method, event.resourceType); } catch { /* fail closed */ }
    void cdp.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
      requestId: event.requestId,
      ...(!allowed && { errorReason: "BlockedByClient" }),
    }).finally(() => {
      if (!allowed && event.resourceType === "Document") Promise.resolve(onBlock()).catch(() => {});
    }).catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return async () => { await cdp.send("Fetch.disable").catch(() => {}); await cdp.detach().catch(() => {}); };
}

export async function startBootstrapEgressProxy() {
  const sockets = new Set();
  const server = createServer((_request, response) => response.writeHead(403).end());
  server.on("connect", (request, client, head) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => {});
    let authority;
    try { authority = new URL(`http://${request.url}`); } catch { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    if (!allowedBootstrapHost(authority.hostname) || authority.port !== "443" || request.url.includes("@")) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect(443, authority.hostname);
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => client.destroy());
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
