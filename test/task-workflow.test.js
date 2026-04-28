import test from "node:test";
import assert from "node:assert/strict";

import { runTaskWorkflow } from "../src/workflow.js";

function createFakeToolSession(pageMap) {
  return {
    currentUrl: null,
    navigationCalls: [],
    async navigate(url) {
      this.currentUrl = url;
      this.navigationCalls = [...this.navigationCalls, url];
    },
    async dismissNuisanceOverlays() {},
    async captureSnapshot() {
      const page = pageMap[this.currentUrl];

      if (!page) {
        throw new Error(`Missing fake page for ${this.currentUrl}`);
      }

      return {
        url: this.currentUrl,
        headings: [],
        buttonTexts: [],
        iframeSources: [],
        sectionCandidates: [],
        discoveredLinks: [],
        ...page.snapshot
      };
    },
    async collectSections() {
      return [];
    },
    async close() {}
  };
}

test("runTaskWorkflow keeps link queries on the AI extraction path by default", async () => {
  const session = createFakeToolSession({
    "https://example.com/docs": {
      snapshot: {
        title: "Docs",
        visibleText: "文档入口",
        discoveredLinks: [
          "https://example.com/docs/start",
          "https://example.com/docs/api"
        ]
      }
    }
  });

  const result = await runTaskWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        return {
          targetSectionSelectors: [],
          extractionMode: "full_text",
          outputShape: "array"
        };
      },
      async extractContent({ snapshot }) {
        return {
          answer: snapshot.discoveredLinks.map((href) => ({ href })),
          confidence: 0.91
        };
      }
    },
    url: "https://example.com/docs",
    userQuery: "列出这个页面的所有链接"
  });

  assert.equal(result.mode, "extract");
  assert.equal(result.tool, "extract");
  assert.deepEqual(result.data, [
    { href: "https://example.com/docs/start" },
    { href: "https://example.com/docs/api" }
  ]);
});

test("runTaskWorkflow auto-routes site summary queries to crawl", async () => {
  const session = createFakeToolSession({
    "https://example.com/": {
      snapshot: {
        title: "首页",
        visibleText: "站点入口",
        discoveredLinks: [
          "https://example.com/articles/a",
          "https://example.com/articles/b"
        ]
      }
    },
    "https://example.com/articles/a": {
      snapshot: {
        title: "A",
        visibleText: "文章 A",
        discoveredLinks: []
      }
    },
    "https://example.com/articles/b": {
      snapshot: {
        title: "B",
        visibleText: "文章 B",
        discoveredLinks: []
      }
    }
  });

  const result = await runTaskWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        return {
          targetSectionSelectors: [],
          extractionMode: "full_text",
          outputShape: "object"
        };
      },
      async extractContent({ snapshot }) {
        return {
          answer: {
            title: snapshot.title
          },
          confidence: 0.9
        };
      },
      async synthesizeCrawlResults({ pages }) {
        return {
          answer: pages.map((page) => page.data.title),
          confidence: 0.8
        };
      }
    },
    url: "https://example.com/",
    userQuery: "汇总站内所有文章标题",
    crawlOptions: {
      maxPages: 3,
      maxDepth: 1
    }
  });

  assert.equal(result.mode, "crawl");
  assert.equal(result.tool, "crawl");
  assert.deepEqual(result.data, ["首页", "A", "B"]);
});

test("runTaskWorkflow keeps extract as the default tool", async () => {
  const session = createFakeToolSession({
    "https://example.com/item": {
      snapshot: {
        title: "Widget",
        visibleText: "Widget 售价 99 元",
        discoveredLinks: []
      }
    }
  });

  const result = await runTaskWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        return {
          targetSectionSelectors: [],
          extractionMode: "full_text",
          outputShape: "object"
        };
      },
      async extractContent() {
        return {
          answer: {
            price: "99 元"
          },
          confidence: 0.95
        };
      }
    },
    url: "https://example.com/item",
    userQuery: "提取价格"
  });

  assert.equal(result.mode, "extract");
  assert.equal(result.tool, "extract");
  assert.deepEqual(result.data, {
    price: "99 元"
  });
});
