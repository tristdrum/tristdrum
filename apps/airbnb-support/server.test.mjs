import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createAirbnbSupportServer } from "./server.mjs";

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
          ...(secret ? { "X-Airbnb-Support-Scheduler-Secret": secret } : {}),
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

test("health is public and reports shadow mode", async () => {
  const response = await request(createAirbnbSupportServer({ secret: "secret" }), { path: "/healthz" });
  assert.equal(response.status, 200);
  assert.equal(response.body.mode, "shadow");
});

test("support run is authenticated and cannot request live mode", async () => {
  const unauthorized = await request(createAirbnbSupportServer({ secret: "secret" }), { method: "POST", path: "/run" });
  assert.equal(unauthorized.status, 401);
  const live = await request(createAirbnbSupportServer({ secret: "secret" }), {
    method: "POST",
    path: "/run",
    secret: "secret",
    body: { mode: "live" },
  });
  assert.equal(live.status, 400);
  assert.equal(live.body.error, "shadow_mode_only");
});

test("shadow endpoint returns a receipt with external writes disabled", async () => {
  const response = await request(createAirbnbSupportServer({
    secret: "secret",
    run: async () => ({ status: "success", mode: "shadow", externalWritesEnabled: false }),
  }), { method: "POST", path: "/run", secret: "secret", body: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.externalWritesEnabled, false);
});
