import test from "node:test";
import assert from "node:assert/strict";

import { runSiteCrawlerWorkflow } from "../src/workflow.js";

function createFakeCrawlSession(pageMap) {
  return {
    currentUrl: null,
    navigationCalls: [],
    collectedSelectors: [],
    persisted: false,
    closed: false,
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
    async collectSections(selectors) {
      this.collectedSelectors = [...this.collectedSelectors, ...selectors];
      return pageMap[this.currentUrl]?.sections ?? [];
    },
    async saveStorageState() {
      this.persisted = true;
    },
    async close() {
      this.closed = true;
    }
  };
}

test("runSiteCrawlerWorkflow crawls in-scope pages and synthesizes page results", async () => {
  const session = createFakeCrawlSession({
    "https://example.com/": {
      snapshot: {
        title: "首页",
        visibleText: "站点入口",
        discoveredLinks: [
          "https://example.com/products/widget-1",
          "https://example.com/articles/launch-post",
          "https://example.com/privacy",
          "https://elsewhere.example.com/offsite"
        ]
      }
    },
    "https://example.com/products/widget-1": {
      snapshot: {
        title: "Widget One",
        visibleText: "Widget One 正文",
        discoveredLinks: ["https://example.com/products/widget-2"]
      }
    },
    "https://example.com/articles/launch-post": {
      snapshot: {
        title: "Launch Post",
        visibleText: "Launch Post 正文",
        discoveredLinks: []
      }
    }
  });

  const result = await runSiteCrawlerWorkflow({
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
            pageTitle: snapshot.title
          },
          confidence: 0.9
        };
      },
      async synthesizeCrawlResults({ pages }) {
        assert.equal(pages.length, 3);

        return {
          answer: pages.map((page) => page.data.pageTitle),
          confidence: 0.82
        };
      }
    },
    url: "https://example.com/",
    userQuery: "汇总这个站点里和产品与文章相关的页面标题",
    crawlOptions: {
      maxPages: 3,
      maxDepth: 2,
      sameOriginOnly: true,
      includePatterns: [],
      excludePatterns: ["*privacy*"],
      budgetEntries: ["/products=1", "/articles=1", "*=10"]
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.mode, "crawl");
  assert.deepEqual(result.data, ["首页", "Widget One", "Launch Post"]);
  assert.equal(result.pages.length, 3);
  assert.deepEqual(
    result.pages.map((page) => page.url),
    [
      "https://example.com/",
      "https://example.com/products/widget-1",
      "https://example.com/articles/launch-post"
    ]
  );
  assert.equal(result.frontierStats.skippedFiltered, 2);
  assert.equal(result.frontierStats.skippedBudget, 1);
  assert.equal(session.closed, true);
});
