#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadSupportStatus, runSupport } from "./runner.mjs";
import { assertSupportModeAllowed, supportRuntimeCapabilities } from "./runtime.mjs";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const MAX_BODY_BYTES = 16 * 1024;

function expectedSecret() {
  const value = String(process.env.AIRBNB_SUPPORT_SCHEDULER_SECRET ?? "");
  if (!value) throw new Error("AIRBNB_SUPPORT_SCHEDULER_SECRET is not configured.");
  return value;
}

export function authorized(request, expected = expectedSecret()) {
  const supplied = String(request.headers["x-airbnb-support-scheduler-secret"] ?? "");
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large."), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export function createAirbnbSupportServer({
  run = runSupport,
  status = loadSupportStatus,
  secret = null,
  env = process.env,
} = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/healthz") {
        const capabilities = supportRuntimeCapabilities(env);
        json(response, 200, {
          ok: true,
          service: "airbnb-support",
          mode: capabilities.mode,
          replyDeliveryEnabled: capabilities.replyDeliveryEnabled,
          autonomousRepliesEnabled: capabilities.autonomousRepliesEnabled,
          managementAlertsEnabled: capabilities.managementAlertsEnabled,
          timeRequestsEnabled: capabilities.timeRequestsEnabled,
        });
        return;
      }
      if (!authorized(request, secret ?? expectedSecret())) {
        json(response, 401, { error: "unauthorized" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/run") {
        const body = await readJson(request);
        const mode = body.mode ?? "shadow";
        try {
          assertSupportModeAllowed(mode, env);
        } catch (error) {
          json(response, 400, {
            error: error.code === "LIVE_MODE_DISABLED" ? "live_mode_disabled" : "invalid_mode",
          });
          return;
        }
        json(response, 200, await run({ mode, env }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        const receipt = await status();
        json(response, receipt ? 200 : 404, receipt ?? { error: "not_found" });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      const statusCode = error.code === "BODY_TOO_LARGE" ? 413
        : error.code === "RUN_IN_PROGRESS" ? 409
          : 500;
      json(response, statusCode, {
        error: "request_failed",
        code: error.code ?? null,
      });
    }
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const server = createAirbnbSupportServer();
  server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({
      event: "listening",
      service: "airbnb-support",
      port: PORT,
      mode: supportRuntimeCapabilities(process.env).mode,
    }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
