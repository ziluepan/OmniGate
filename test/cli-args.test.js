import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArguments,
  validateCliArguments
} from "../src/cli-args.js";

test("parseArguments supports spider-style crawl flags", () => {
  const parsed = parseArguments([
    "--url",
    "https://example.com",
    "--query",
    "汇总产品",
    "--tool",
    "crawl",
    "--crawl",
    "--max-pages",
    "12",
    "--max-depth",
    "3",
    "--include",
    "*products*",
    "--include",
    "*articles*",
    "--exclude",
    "*privacy*",
    "--budget",
    "/products=4",
    "--allow-external",
    "--round-robin-domains"
  ]);

  assert.equal(parsed.crawl, true);
  assert.equal(parsed.tool, "crawl");
  assert.equal(parsed.maxPages, 12);
  assert.equal(parsed.maxDepth, 3);
  assert.deepEqual(parsed.includePatterns, ["*products*", "*articles*"]);
  assert.deepEqual(parsed.excludePatterns, ["*privacy*"]);
  assert.deepEqual(parsed.budgetEntries, ["/products=4"]);
  assert.equal(parsed.sameOriginOnly, false);
  assert.equal(parsed.roundRobinDomains, true);
});

test("validateCliArguments rejects invalid crawl values", () => {
  assert.throws(
    () =>
      validateCliArguments({
        headful: true,
        manualAuth: false,
        tool: "unknown",
        maxPages: 1,
        maxDepth: 1
      }),
    /--tool must be one of/u
  );

  assert.throws(
    () =>
      validateCliArguments({
        headful: false,
        manualAuth: true,
        maxPages: 0,
        maxDepth: -1
      }),
    /--manual-auth requires --headful/u
  );

  assert.throws(
    () =>
      validateCliArguments({
        headful: true,
        manualAuth: false,
        maxPages: 0,
        maxDepth: 1
      }),
    /--max-pages must be a positive integer/u
  );

  assert.throws(
    () =>
      validateCliArguments({
        headful: true,
        manualAuth: false,
        maxPages: 1,
        maxDepth: -1
      }),
    /--max-depth must be a non-negative integer/u
  );
});
