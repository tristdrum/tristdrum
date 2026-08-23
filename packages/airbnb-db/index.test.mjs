import assert from "node:assert/strict";
import test from "node:test";
import { redactCredentialText, sanitizedError } from "./index.mjs";

test("credential-shaped scalar text is redacted without hiding ordinary context", () => {
  const input = "request failed: Bearer abc.def; api_key=secret-value; serialized={\"apiKey\":\"json-secret\"}; postgresql://user:pass@db.example/airbnb";
  const redacted = redactCredentialText(input);

  assert.equal(redacted.includes("abc.def"), false);
  assert.equal(redacted.includes("secret-value"), false);
  assert.equal(redacted.includes("json-secret"), false);
  assert.equal(redacted.includes("user:pass"), false);
  assert.match(redacted, /request failed/);
  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.match(redacted, /api_key=\[REDACTED\]/);
  assert.match(redacted, /postgresql:\/\/\[REDACTED\]/);
});

test("sanitized errors redact credentials before enforcing the receipt bound", () => {
  const error = new Error(`SMTP rejected authorization: Basic dXNlcjpwYXNz ${"detail ".repeat(100)}`);
  error.code = "TOKEN=raw-code-secret";
  const sanitized = sanitizedError(error);

  assert.equal(sanitized.message.includes("dXNlcjpwYXNz"), false);
  assert.equal(sanitized.code.includes("raw-code-secret"), false);
  assert.ok(sanitized.message.length <= 300);
});
