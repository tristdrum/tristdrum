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
});

test("run is authenticated and rejects any live mode", async () => {
  const unauthorized = await request(createAirbnbStockServer({ secret: "secret" }), { method: "POST", path: "/run" });
  assert.equal(unauthorized.status, 401);
  const live = await request(createAirbnbStockServer({ secret: "secret" }), {
    method: "POST",
    path: "/run",
    secret: "secret",
    body: { mode: "live" },
  });
  assert.equal(live.status, 400);
  assert.equal(live.body.error, "observation_mode_only");
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
  assert.equal(response.body.fullReview, true);
  assert.equal(response.body.externalWritesEnabled, false);
  assert.equal(calls, 1);
});
