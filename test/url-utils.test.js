import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHttpUrl } from "../src/url-utils.js";

test("normalizeHttpUrl keeps valid https URLs", () => {
  assert.equal(
    normalizeHttpUrl("https://example.com/products?id=1"),
    "https://example.com/products?id=1"
  );
});

test("normalizeHttpUrl rejects non-http protocols", () => {
  assert.throws(
    () => normalizeHttpUrl("file:///etc/passwd"),
    /Only http:\/\/ and https:\/\//
  );
});

test("normalizeHttpUrl rejects malformed URLs", () => {
  assert.throws(() => normalizeHttpUrl("not a url"), /target URL is invalid/i);
});
