import test from "node:test";
import assert from "node:assert/strict";

import { resolveChoice } from "../src/utils/prompt.js";

const options = [
  { key: "1", label: "project", value: "project" },
  { key: "2", label: "user", value: "user" },
  { key: "3", label: "local", value: "local" }
];

test("resolveChoice accepts numeric menu selection", () => {
  const result = resolveChoice(options, "2", "1");
  assert.equal(result.value, "user");
});

test("resolveChoice accepts option label input", () => {
  const result = resolveChoice(options, "local", "1");
  assert.equal(result.value, "local");
});

test("resolveChoice falls back to the default option when input is blank", () => {
  const result = resolveChoice(options, "", "1");
  assert.equal(result.value, "project");
});

test("resolveChoice rejects unknown values", () => {
  assert.throws(() => resolveChoice(options, "banana", "1"), /Unknown choice/);
});
