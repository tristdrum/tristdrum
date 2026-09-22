import assert from "node:assert/strict";
import test from "node:test";
import { sendPing, validatePingPayload } from "./ping.mjs";

const payload = { title: "Airbnb Management", urgency: "normal", body: "  Exact summary\nsecond line.  ", dedupeKey: "event-1" };
const env = { PING_API_KEY: "mock-key" };

test("Ping makes one bounded request and preserves the exact summary", async () => {
  let calls = 0;
  const result = await sendPing(payload, { env, fetchFn: async (url, options) => {
    calls += 1;
    assert.equal(url, "https://ping.techlocal.co.za/api/v1/notify");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, "Bearer mock-key");
    assert.deepEqual(JSON.parse(options.body), payload);
    return new Response(JSON.stringify({ accepted: true, deduplicated: true,
      requestId: "00000000-0000-4000-8000-000000000001", private: "never-return" }), { status: 202 });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, accepted: true, status: 202, deduplicated: true,
    requestId: "00000000-0000-4000-8000-000000000001", delivery: "accepted", retryable: false });
});

test("missing key performs no request and cannot be retried unchanged", async () => {
  const result = await sendPing(payload, { env: {}, fetchFn: () => assert.fail("must not send") });
  assert.equal(result.error, "missing_api_key");
  assert.equal(result.retryable, false);
});

test("network exceptions are sanitized and never retried by the transport", async () => {
  let calls = 0;
  const result = await sendPing(payload, { env, fetchFn: async () => {
    calls += 1;
    throw new Error("authorization: Bearer secret-key");
  } });
  assert.equal(calls, 1);
  assert.equal(result.error, "network_or_timeout");
  assert.equal(result.retryable, true);
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});

test("HTTP acceptance, transient failures and permanent failures are distinguished", async () => {
  for (const [status, body, retryable, accepted] of [
    [202, { accepted: true }, false, true],
    [200, { accepted: true }, true, false],
    [202, { accepted: false }, true, false],
    [401, { error: "invalid_api_key" }, false, false],
    [403, null, false, false],
    [400, { error: "invalid_request" }, false, false],
    [413, { error: "payload_too_large" }, false, false],
    [429, { error: "rate_limited" }, true, false],
    [503, { error: "apns_submission_failed" }, true, false],
    [503, { error: "invalid_api_key" }, false, false],
    [500, { error: "secret-body", requestId: "secret-id" }, true, false],
    [502, null, true, false],
  ]) {
    const result = await sendPing(payload, { env, fetchFn: async () => new Response(
      body === null ? "invalid JSON" : JSON.stringify(body), { status },
    ) });
    assert.equal(result.retryable, retryable, String(status));
    assert.equal(result.accepted, accepted, String(status));
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("validation rejects invalid or oversized payloads before a request", async () => {
  for (const input of [null, [], { ...payload, body: " " }, { ...payload, body: "a".repeat(1001) },
    { ...payload, title: "a".repeat(121) }, { ...payload, dedupeKey: "a".repeat(129) },
    { ...payload, dedupeKey: "non\nprintable" }, { ...payload, urgency: "critical" }]) {
    await assert.rejects(sendPing(input, { env, fetchFn: () => assert.fail("must not send") }));
  }
  assert.equal(validatePingPayload({ ...payload, body: "a".repeat(1000) }).body.length, 1000);
});
