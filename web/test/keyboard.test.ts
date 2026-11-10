import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollDeltaFor } from "../src/keyboard.ts";

// Phone: 800 px tall page, keyboard leaves the top 450 px visible.
test("a field hidden by the keyboard is lifted to just above it", () => {
  assert.equal(scrollDeltaFor(600, 650, 0, 450), 650 - (450 - 12));
});
test("a field already visible is left alone", () => {
  assert.equal(scrollDeltaFor(200, 250, 0, 450), 0);
});
test("a field under the header is scrolled back down into view", () => {
  assert.equal(scrollDeltaFor(20, 70, 0, 450), 20 - 72);
});
test("a tall text box keeps its top in view rather than its bottom", () => {
  // 500 px textarea starting at 300: aligning the bottom would hide the top, so align the top.
  assert.equal(scrollDeltaFor(300, 800, 0, 450), 300 - 72);
});
