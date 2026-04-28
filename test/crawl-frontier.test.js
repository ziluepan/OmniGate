import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreDiscoveredUrl,
  UrlFrontier
} from "../src/crawl-frontier.js";

test("scoreDiscoveredUrl prefers shallow, content-rich urls", () => {
  const highValueScore = scoreDiscoveredUrl(
    "https://example.com/products/widget-1",
    1
  );
  const lowValueScore = scoreDiscoveredUrl(
    "https://example.com/privacy",
    1
  );
  const deeperScore = scoreDiscoveredUrl(
    "https://example.com/products/widget-1",
    3
  );

  assert.ok(highValueScore > lowValueScore);
  assert.ok(highValueScore > deeperScore);
});

test("UrlFrontier de-duplicates urls and pops higher-priority entries first", () => {
  const frontier = new UrlFrontier();

  assert.equal(
    frontier.push({
      url: "https://example.com/privacy",
      depth: 1
    }),
    true
  );
  assert.equal(
    frontier.push({
      url: "https://example.com/products/widget-1",
      depth: 1
    }),
    true
  );
  assert.equal(
    frontier.push({
      url: "https://example.com/products/widget-1",
      depth: 1
    }),
    false
  );

  assert.equal(frontier.pop().url, "https://example.com/products/widget-1");
  assert.equal(frontier.pop().url, "https://example.com/privacy");
  assert.equal(frontier.pop(), null);
});

test("UrlFrontier can round-robin across domains when alternatives exist", () => {
  const frontier = new UrlFrontier({
    roundRobinDomains: true
  });

  frontier.push({
    url: "https://alpha.example.com/products/widget-1",
    depth: 1
  });
  frontier.push({
    url: "https://alpha.example.com/products/widget-2",
    depth: 1
  });
  frontier.push({
    url: "https://beta.example.com/docs/start",
    depth: 1
  });

  const first = frontier.pop();
  const second = frontier.pop();

  assert.ok(first.url.startsWith("https://alpha.example.com/"));
  assert.equal(second.url, "https://beta.example.com/docs/start");
});
