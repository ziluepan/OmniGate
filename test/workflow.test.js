import test from "node:test";
import assert from "node:assert/strict";

import { runCrawlerWorkflow } from "../src/workflow.js";

function createFakeSession({
  snapshot,
  postVerificationSnapshot,
  sections = [],
  finalUrl = "https://example.com/page"
} = {}) {
  return {
    navigationCalls: [],
    dismissCalls: 0,
    collectedSelectors: [],
    persisted: false,
    finalUrl,
    async navigate(url) {
      this.navigationCalls = [...this.navigationCalls, url];
    },
    async dismissNuisanceOverlays() {
      this.dismissCalls += 1;
    },
    async captureSnapshot() {
      return snapshot;
    },
    async waitForManualVerification() {
      return postVerificationSnapshot ?? null;
    },
    async collectSections(selectors) {
      this.collectedSelectors = [...selectors];
      return sections;
    },
    async saveStorageState() {
      this.persisted = true;
    },
    async close() {}
  };
}

test("runCrawlerWorkflow stops when a verification wall remains", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/page",
      title: "Security check",
      visibleText: "Please verify you are human before accessing this page.",
      headings: ["Verify you are human"],
      buttonTexts: ["Continue"],
      iframeSources: []
    }
  });

  let analyzeCalled = false;

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        analyzeCalled = true;
        return {};
      },
      async extractContent() {
        return {};
      }
    },
    url: "https://example.com/page",
    userQuery: "提取正文"
  });

  assert.equal(result.status, "blocked");
  assert.equal(analyzeCalled, false);
});

test("runCrawlerWorkflow can return full content directly without calling AI", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/article",
      title: "长文",
      visibleText: "这是截断后的前几句……",
      fullVisibleText: "第一段。\n\n第二段。\n\n第三段。",
      headings: ["长文标题"],
      buttonTexts: [],
      iframeSources: [],
      sectionCandidates: []
    }
  });

  let analyzeCalled = false;
  let extractCalled = false;

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        analyzeCalled = true;
        return {};
      },
      async extractContent() {
        extractCalled = true;
        return {};
      }
    },
    url: "https://example.com/article",
    userQuery: "直接返回全部内容",
    options: {
      returnFullContent: true
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "browser");
  assert.equal(result.contentFormat, "text");
  assert.equal(result.data, "第一段。\n\n第二段。\n\n第三段。");
  assert.equal(result.contentLength, "第一段。\n\n第二段。\n\n第三段。".length);
  assert.equal(analyzeCalled, false);
  assert.equal(extractCalled, false);
});

test("runCrawlerWorkflow analyzes the page and extracts requested content", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/page",
      title: "产品详情",
      visibleText: "超级咖啡机。售价 299 元。支持冷热双模式。",
      headings: ["超级咖啡机"],
      buttonTexts: ["购买"],
      iframeSources: [],
      sectionCandidates: [
        {
          selector: "main article",
          textSample: "超级咖啡机。售价 299 元。支持冷热双模式。"
        }
      ]
    },
    sections: [
      {
        selector: "main article",
        text: "超级咖啡机。售价 299 元。支持冷热双模式。"
      }
    ]
  });

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure({ snapshot, userQuery }) {
        assert.equal(snapshot.title, "产品详情");
        assert.equal(userQuery, "提取产品名、价格和主要特点");

        return {
          targetSectionSelectors: ["main article"],
          extractionMode: "sections",
          outputShape: "object"
        };
      },
      async extractContent({ sections }) {
        assert.equal(sections.length, 1);

        return {
          answer: {
            name: "超级咖啡机",
            price: "299 元",
            features: ["冷热双模式"]
          },
          confidence: 0.91
        };
      }
    },
    url: "https://example.com/page",
    userQuery: "提取产品名、价格和主要特点"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.data.name, "超级咖啡机");
  assert.deepEqual(session.collectedSelectors, ["main article"]);
});

test("runCrawlerWorkflow can continue after legitimate manual verification", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/page",
      title: "Just a moment...",
      visibleText: "Verify you are human to continue.",
      headings: ["Security check"],
      buttonTexts: ["Verify you are human"],
      iframeSources: []
    },
    postVerificationSnapshot: {
      url: "https://example.com/page",
      title: "公开文章",
      visibleText: "这里是公开文章正文。",
      headings: ["文章标题"],
      buttonTexts: [],
      iframeSources: [],
      sectionCandidates: []
    }
  });

  const result = await runCrawlerWorkflow({
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
            title: "文章标题"
          },
          confidence: 0.88
        };
      }
    },
    url: "https://example.com/page",
    userQuery: "提取标题",
    options: {
      allowManualVerification: true,
      persistStorageState: true
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(session.persisted, true);
});

test("runCrawlerWorkflow can fall back to a readable mirror when the browser hits a verification wall", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://www.69shuba.com/txt/15054/29814105",
      title: "Just a moment...",
      visibleText: "Verify you are human to continue.",
      headings: ["Security check"],
      buttonTexts: ["Verify you are human"],
      iframeSources: ["https://challenges.cloudflare.com/challenge-platform/h/g/orchestrate"]
    }
  });

  let fallbackCalls = 0;

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure({ snapshot }) {
        assert.equal(snapshot.title, "一世之尊-第732章 无耻小孟（求月票）-69书吧");

        return {
          targetSectionSelectors: [],
          extractionMode: "full_text",
          outputShape: "object"
        };
      },
      async extractContent({ snapshot }) {
        assert.match(snapshot.visibleText, /第732章 无耻小孟/u);

        return {
          answer: {
            title: "第732章 无耻小孟（求月票）",
            work: "一世之尊"
          },
          confidence: 0.87
        };
      }
    },
    fallbackSnapshotProvider: {
      async fetch({ url, blockedSnapshot }) {
        fallbackCalls += 1;
        assert.equal(url, "https://www.69shuba.com/txt/15054/29814105");
        assert.equal(blockedSnapshot.title, "Just a moment...");

        return {
          source: "readable_mirror",
          snapshot: {
            url,
            title: "一世之尊-第732章 无耻小孟（求月票）-69书吧",
            metaDescription: "",
            headings: ["第732章 无耻小孟（求月票）"],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [
              {
                selector: "markdown-body",
                tagName: "article",
                textSample: "第732章 无耻小孟（求月票）……"
              }
            ],
            visibleText:
              "2022-08-09 作者： 爱潜水的乌贼 第732章 无耻小孟（求月票） “刘韵陶被义军阵营轮回者击杀，每人扣除一千善功。”"
          }
        };
      }
    },
    url: "https://www.69shuba.com/txt/15054/29814105",
    userQuery: "这页是什么内容？"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "readable_mirror");
  assert.equal(fallbackCalls, 1);
  assert.equal(result.data.work, "一世之尊");
});

test("runCrawlerWorkflow can return full readable-mirror content directly", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://www.69shuba.com/txt/15054/29814105",
      title: "Just a moment...",
      visibleText: "Verify you are human to continue.",
      headings: ["Security check"],
      buttonTexts: ["Verify you are human"],
      iframeSources: ["https://challenges.cloudflare.com/challenge-platform/h/g/orchestrate"]
    }
  });

  let analyzeCalled = false;

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        analyzeCalled = true;
        return {};
      },
      async extractContent() {
        return {};
      }
    },
    fallbackSnapshotProvider: {
      async fetch({ url }) {
        return {
          source: "readable_mirror",
          snapshot: {
            url,
            title: "一世之尊-第732章 无耻小孟（求月票）-69书吧",
            metaDescription: "",
            headings: ["第732章 无耻小孟（求月票）"],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [],
            visibleText: "截断内容",
            fullVisibleText: "纯文本全文",
            rawMarkdown: "# 第732章 无耻小孟（求月票）\n\n全文原样返回"
          }
        };
      }
    },
    url: "https://www.69shuba.com/txt/15054/29814105",
    userQuery: "直接返回全部内容",
    options: {
      returnFullContent: true
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "readable_mirror");
  assert.equal(result.contentFormat, "markdown");
  assert.equal(result.data, "# 第732章 无耻小孟（求月票）\n\n全文原样返回");
  assert.equal(analyzeCalled, false);
});
