import test from "node:test";
import assert from "node:assert/strict";

import { asToolResult, toStructuredContent } from "../src/core/mcp-format.js";

test("structured content passes object results through unchanged", () => {
  const result = { mode_used: "lexical", hits: [] };
  assert.deepEqual(toStructuredContent(result), result);
});

test("structured content wraps array results in an object", () => {
  const items = [{ id: "mem_1" }, { id: "mem_2" }];
  assert.deepEqual(toStructuredContent(items), { items });
});

test("tool results always expose object-shaped structured content", () => {
  const toolResult = asToolResult([{ id: "mem_1" }]);
  assert.deepEqual(toolResult.structuredContent, { items: [{ id: "mem_1" }] });
  assert.match(toolResult.content[0].text, /mem_1/);
});
