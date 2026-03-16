import test from "node:test";
import assert from "node:assert/strict";

import { timingSafeCompare } from "../src/utils/crypto.js";
import { normalizeError } from "../src/core/runtime-errors.js";
import { hasValidAccessKey } from "../src/core/mcp-security.js";

test("timingSafeCompare returns true for equal strings", () => {
  assert.equal(timingSafeCompare("secret-key-123", "secret-key-123"), true);
  assert.equal(timingSafeCompare("", ""), true);
});

test("timingSafeCompare returns false for different strings of same length", () => {
  assert.equal(timingSafeCompare("secret-key-aaa", "secret-key-bbb"), false);
});

test("timingSafeCompare returns false for different lengths", () => {
  assert.equal(timingSafeCompare("short", "much-longer-string"), false);
  assert.equal(timingSafeCompare("much-longer-string", "short"), false);
});

test("timingSafeCompare returns false for non-string inputs", () => {
  assert.equal(timingSafeCompare(null, "secret"), false);
  assert.equal(timingSafeCompare("secret", undefined), false);
  assert.equal(timingSafeCompare(123, "123"), false);
  assert.equal(timingSafeCompare({}, "object"), false);
});

test("normalizeError sanitizes unknown error messages", () => {
  const dbError = new Error("relation memory_items does not exist");
  const normalized = normalizeError(dbError, "req-test-1");
  assert.equal(normalized.message, "An internal error occurred");
  assert.equal(normalized.category, "internal_error");
  assert.equal(normalized.details.request_id, "req-test-1");
});

test("normalizeError passes through known validation patterns", () => {
  const validationErr = new Error("Field is required");
  const normalized = normalizeError(validationErr, "req-test-2");
  assert.equal(normalized.message, "Field is required");
  assert.equal(normalized.category, "validation_error");
});

test("hasValidAccessKey uses timing-safe comparison", () => {
  const request = new Request("https://example.test", {
    headers: { "x-memory-key": "correct-key" }
  });
  assert.equal(hasValidAccessKey(request, "correct-key"), true);
  assert.equal(hasValidAccessKey(request, "wrong-key"), false);
});

test("hasValidAccessKey rejects bearer token with wrong key", () => {
  const request = new Request("https://example.test", {
    headers: { "authorization": "Bearer my-secret" }
  });
  assert.equal(hasValidAccessKey(request, "my-secret"), true);
  assert.equal(hasValidAccessKey(request, "not-my-secret"), false);
});
