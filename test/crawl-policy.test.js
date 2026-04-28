import test from "node:test";
import assert from "node:assert/strict";

import {
  CrawlBudgetTracker,
  evaluateDiscoveredUrl
} from "../src/crawl-policy.js";

test("evaluateDiscoveredUrl rejects off-origin, excluded, and too-deep urls", () => {
  const commonPolicy = {
    seedUrl: "https://example.com/start",
    maxDepth: 2,
    sameOriginOnly: true,
    includePatterns: [],
    excludePatterns: ["*privacy*", "*logout*"]
  };

  assert.deepEqual(
    evaluateDiscoveredUrl({
      candidateUrl: "https://elsewhere.example.com/article",
      depth: 1,
      policy: commonPolicy
    }),
    {
      accepted: false,
      reason: "origin"
    }
  );

  assert.deepEqual(
    evaluateDiscoveredUrl({
      candidateUrl: "https://example.com/privacy",
      depth: 1,
      policy: commonPolicy
    }),
    {
      accepted: false,
      reason: "exclude"
    }
  );

  assert.deepEqual(
    evaluateDiscoveredUrl({
      candidateUrl: "https://example.com/articles/deep",
      depth: 3,
      policy: commonPolicy
    }),
    {
      accepted: false,
      reason: "depth"
    }
  );
});

test("evaluateDiscoveredUrl enforces include patterns when provided", () => {
  const result = evaluateDiscoveredUrl({
    candidateUrl: "https://example.com/products/widget-1",
    depth: 1,
    policy: {
      seedUrl: "https://example.com/start",
      maxDepth: 2,
      sameOriginOnly: true,
      includePatterns: ["*articles*", "*guides*"],
      excludePatterns: []
    }
  });

  assert.deepEqual(result, {
    accepted: false,
    reason: "include"
  });
});

test("CrawlBudgetTracker applies the longest matching budget rule", () => {
  const tracker = new CrawlBudgetTracker(["*=5", "/products=1", "/articles=2"]);

  assert.deepEqual(
    tracker.tryConsume("https://example.com/products/widget-1"),
    {
      accepted: true,
      rule: "/products"
    }
  );
  assert.deepEqual(
    tracker.tryConsume("https://example.com/products/widget-2"),
    {
      accepted: false,
      rule: "/products"
    }
  );
  assert.deepEqual(
    tracker.tryConsume("https://example.com/articles/post-1"),
    {
      accepted: true,
      rule: "/articles"
    }
  );
  assert.deepEqual(
    tracker.tryConsume("https://example.com/docs/start"),
    {
      accepted: true,
      rule: "*"
    }
  );
});
