import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createAirbnbStockServer } from "./server.mjs";

async function request(server, { method = "GET", path = "/", secret = null, body = null } = {}) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: address.port,
        path,
        method,
        headers: {
          ...(secret ? { "X-Airbnb-Stock-Scheduler-Secret": secret } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health is public and identifies observation mode", async () => {
  const response = await request(createAirbnbStockServer({ secret: "secret" }), { path: "/healthz" });
  assert.equal(response.status, 200);
  assert.equal(response.body.mode, "observation");
  assert.equal(response.body.managementAlertsEnabled, false);
  assert.equal(response.body.orderPlacementAllowed, false);
});

test("run is authenticated and rejects live mode without every gate", async () => {
  const unauthorized = await request(createAirbnbStockServer({ secret: "secret" }), { method: "POST", path: "/run" });
  assert.equal(unauthorized.status, 401);
  const live = await request(createAirbnbStockServer({ secret: "secret" }), {
    method: "POST",
    path: "/run",
    secret: "secret",
    body: { mode: "live" },
  });
  assert.equal(live.status, 400);
  assert.equal(live.body.error, "live_mode_disabled");
});

test("authenticated observation returns only the runner receipt", async () => {
  let calls = 0;
  const server = createAirbnbStockServer({
    secret: "secret",
    now: () => new Date("2026-08-18T07:00:00Z"),
    run: async ({ fullReview }) => {
      calls += 1;
      return { status: "success", mode: "observation", fullReview, externalWritesEnabled: false };
    },
  });
  const response = await request(server, { method: "POST", path: "/run", secret: "secret", body: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.fullReview, false);
  assert.equal(response.body.externalWritesEnabled, false);
  assert.equal(calls, 1);
});

test("live mode reaches the runner only after all exact Management gates pass", async () => {
  const calls = [];
  const env = {
    AIRBNB_STOCK_EXTERNAL_WRITES_ENABLED: "true",
    AIRBNB_STOCK_LIVE_CONFIRMATION: "ENABLE_AIRBNB_STOCK_MANAGEMENT_WRITES",
    AIRBNB_STOCK_MANAGEMENT_ALERTS_ENABLED: "true",
    AIRBNB_WHATSAPP_CHAT_ID: "maids@g.us",
    AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
  };
  const server = createAirbnbStockServer({
    secret: "secret",
    env,
    run: async (options) => {
      calls.push(options);
      return {
        status: "success",
        mode: options.mode,
        externalWritesEnabled: true,
        orderPlacementAllowed: false,
      };
    },
  });
  const response = await request(server, {
    method: "POST",
    path: "/run",
    secret: "secret",
    body: { mode: "live", fullReview: false },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mode, "live");
  assert.equal(response.body.orderPlacementAllowed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "live");
  assert.equal(calls[0].env, env);
});

test("unsupported stock modes fail closed before the runner", async () => {
  let called = false;
  const response = await request(createAirbnbStockServer({
    secret: "secret",
    run: async () => {
      called = true;
    },
  }), {
    method: "POST",
    path: "/run",
    secret: "secret",
    body: { mode: "order" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_mode");
  assert.equal(called, false);
});
