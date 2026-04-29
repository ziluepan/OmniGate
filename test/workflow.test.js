import test from "node:test";
import assert from "node:assert/strict";

import { registerBuiltInSkills } from "../src/skills/bootstrap.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { runCrawlerWorkflow } from "../src/workflow.js";

function createFakeSession({
  snapshot,
  postVerificationSnapshot,
  sections = [],
  finalUrl = "https://example.com/page",
  navigateError = null,
  captureError = null
} = {}) {
  return {
    navigationCalls: [],
    dismissCalls: 0,
    collectedSelectors: [],
    persisted: false,
    closeCalls: 0,
    finalUrl,
    async navigate(url) {
      if (navigateError) {
        throw navigateError;
      }
      this.navigationCalls = [...this.navigationCalls, url];
    },
    async dismissNuisanceOverlays() {
      this.dismissCalls += 1;
    },
    async captureSnapshot() {
      if (captureError) {
        throw captureError;
      }
      return snapshot;
    },
    async waitForManualVerification() {
      return postVerificationSnapshot ?? null;
    },
    async collectSections(selectors, options) {
      this.collectedSelectors = [...selectors];
      this.collectedOptions = options ?? null;
      return sections;
    },
    async saveStorageState() {
      this.persisted = true;
    },
    async close() {
      this.closeCalls += 1;
    }
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

test("runCrawlerWorkflow supports multi-block text extraction", async () => {
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/chapter-1",
      title: "第一章",
      visibleText: "第一段 第二段 附注",
      headings: ["第一章"],
      buttonTexts: [],
      iframeSources: [],
      sectionCandidates: [
        {
          selector: "main .chapter p",
          textSample: "第一段……第二段……"
        },
        {
          selector: ".chapter-notes",
          textSample: "附注"
        }
      ]
    },
    sections: [
      {
        selector: "main .chapter p",
        text: "第一段。\n\n第二段。"
      },
      {
        selector: ".chapter-notes",
        text: "附注。"
      }
    ]
  });

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure() {
        return {
          targetSectionSelectors: [
            "main .chapter p",
            ".chapter-notes"
          ],
          extractionMode: "sections",
          outputShape: "text"
        };
      },
      async extractContent({ plan, sections }) {
        assert.equal(plan.outputShape, "text");
        assert.equal(sections.length, 2);
        assert.equal(sections[0].selector, "main .chapter p");
        assert.equal(sections[1].selector, ".chapter-notes");

        return {
          answer: `${sections[0].text}\n\n${sections[1].text}`,
          confidence: 0.9
        };
      }
    },
    url: "https://example.com/chapter-1",
    userQuery: "提取这一章完整正文"
  });

  assert.equal(result.status, "ok");
  assert.equal(
    result.data,
    "第一段。\n\n第二段。\n\n附注。"
  );
  assert.deepEqual(session.collectedSelectors, [
    "main .chapter p",
    ".chapter-notes"
  ]);
  assert.equal(session.collectedOptions.mergeMatches, true);
  assert.equal(session.collectedOptions.maxMatches, 40);
  assert.equal(session.collectedOptions.preserveFormatting, true);
});

test("runCrawlerWorkflow passes matched skill hints into the extraction pipeline", async () => {
  const registry = new SkillRegistry();
  registerBuiltInSkills(registry);
  let intentCalled = false;
  let analyzeCalled = false;
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/products/widget-1",
      title: "Widget 1 - 立即购买",
      visibleText: "Widget 1 售价 99 元，库存充足。",
      headings: ["Widget 1"],
      buttonTexts: ["加入购物车"],
      iframeSources: [],
      sectionCandidates: [
        {
          selector: ".product-detail",
          textSample: "Widget 1 售价 99 元，库存充足。"
        }
      ]
    },
    sections: [
      {
        selector: ".product-detail",
        text: "Widget 1 售价 99 元，库存充足。"
      }
    ]
  });

  const result = await runCrawlerWorkflow({
    session,
    registry,
    aiClient: {
      async analyzeUserIntent() {
        intentCalled = true;
        throw new Error("analyzeUserIntent should not be called for obvious product pages");
      },
      async analyzeStructure({ skillExtractStrategy, snapshot }) {
        analyzeCalled = true;
        assert.deepEqual(skillExtractStrategy.selectors.slice(0, 3), [
          "main",
          ".product-detail",
          ".product-main"
        ]);
        assert.equal(skillExtractStrategy.outputShape, "object");
        assert.equal(snapshot.title, "Widget 1 - 立即购买");

        return {
          targetSectionSelectors: [".product-detail"],
          extractionMode: "sections",
          outputShape: "object"
        };
      },
      async extractContent({ extractionPrompt, plan, sections, snapshot }) {
        assert.match(extractionPrompt, /这是一个商品详情页/u);
        assert.match(extractionPrompt, /规格参数/u);
        assert.equal(plan.extractionMode, "sections");
        assert.equal(plan.outputShape, "object");
        assert.deepEqual(plan.targetSectionSelectors, [".product-detail"]);
        assert.equal(sections.length, 1);
        assert.equal(sections[0].selector, ".product-detail");
        assert.equal(snapshot.fullVisibleText, undefined);

        return {
          answer: {
            name: "Widget 1",
            price: "99 元"
          },
          confidence: 0.92
        };
      }
    },
    url: "https://example.com/products/widget-1",
    userQuery: "提取商品标题、价格和规格"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.data.name, "Widget 1");
  assert.equal(intentCalled, false);
  assert.equal(analyzeCalled, true);
  assert.deepEqual(session.collectedSelectors, [".product-detail"]);
});

test("runCrawlerWorkflow keeps a sufficient HTTP fallback on the fast path without creating a browser", async () => {
  const registry = new SkillRegistry();
  registerBuiltInSkills(registry);
  let browserCreated = false;

  const result = await runCrawlerWorkflow({
    session: null,
    getSession: async () => {
      browserCreated = true;
      throw new Error("browser should not be created for a sufficient fallback snapshot");
    },
    registry,
    aiClient: {
      async analyzeUserIntent() {
        throw new Error("analyzeUserIntent should not be called for obvious article pages");
      },
      async analyzeStructure({ snapshot }) {
        assert.match(snapshot.fullVisibleText, /More focused article body/u);

        return {
          targetSectionSelectors: ["article"],
          extractionMode: "sections",
          outputShape: "object"
        };
      },
      async extractContent({ sections, plan }) {
        assert.equal(plan.extractionMode, "sections");
        assert.equal(sections.length, 1);
        assert.equal(sections[0].selector, "article");

        return {
          answer: {
            title: "Fast Path Article"
          },
          confidence: 0.94
        };
      }
    },
    fallbackSnapshotProvider: {
      async fetch({ url }) {
        return {
          source: "http_fetch",
          snapshot: {
            url,
            title: "Fast Path Article",
            metaDescription: "",
            headings: ["Fast Path Article"],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [
              {
                selector: "article",
                tagName: "article",
                textSample: "Focused article body..."
              }
            ],
            visibleText: "Fast Path Article Focused article body",
            fullVisibleText:
              "Fast Path Article\n\nFocused article body\n\nMore focused article body"
          },
          async collectSections(selectors) {
            assert.ok(selectors.includes("article"));

            return [
              {
                selector: "article",
                text: "Focused article body\n\nMore focused article body"
              }
            ];
          }
        };
      }
    },
    url: "https://example.com/blog/fast-path",
    userQuery: "提取这篇文章的标题和正文摘要"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "http_fetch");
  assert.equal(result.data.title, "Fast Path Article");
  assert.equal(browserCreated, false);
});

test("runCrawlerWorkflow upgrades to the browser when the HTTP fallback is too thin", async () => {
  let browserCreated = false;
  const analyzedTitles = [];
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/products/widget-1",
      title: "Widget 1 - 立即购买",
      visibleText: "Widget 1 售价 99 元，库存充足。",
      headings: ["Widget 1"],
      buttonTexts: ["加入购物车"],
      iframeSources: [],
      sectionCandidates: [
        {
          selector: ".product-detail",
          textSample: "Widget 1 售价 99 元，库存充足。"
        }
      ]
    },
    sections: [
      {
        selector: ".product-detail",
        text: "Widget 1 售价 99 元，库存充足。"
      }
    ]
  });

  const result = await runCrawlerWorkflow({
    session: null,
    getSession: async () => {
      browserCreated = true;
      return session;
    },
    registry: (() => {
      const registry = new SkillRegistry();
      registerBuiltInSkills(registry);
      return registry;
    })(),
    aiClient: {
      async analyzeUserIntent() {
        throw new Error("analyzeUserIntent should not be called for obvious product pages");
      },
      async analyzeStructure({ snapshot }) {
        analyzedTitles.push(snapshot.title);
        if (snapshot.title === "Loading...") {
          return {
            targetSectionSelectors: [],
            extractionMode: "full_text",
            outputShape: "object"
          };
        }

        return {
          targetSectionSelectors: [".product-detail"],
          extractionMode: "sections",
          outputShape: "object"
        };
      },
      async extractContent({ sections }) {
        assert.equal(sections.length, 1);
        assert.equal(sections[0].selector, ".product-detail");

        return {
          answer: {
            name: "Widget 1",
            price: "99 元"
          },
          confidence: 0.96
        };
      }
    },
    fallbackSnapshotProvider: {
      async fetch({ url }) {
        return {
          source: "http_fetch",
          snapshot: {
            url,
            title: "Loading...",
            metaDescription: "",
            headings: [],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [],
            visibleText: "Loading...",
            fullVisibleText: "Loading..."
          },
          async collectSections() {
            return [];
          }
        };
      }
    },
    url: "https://example.com/products/widget-1",
    userQuery: "提取商品标题、价格和规格"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "browser");
  assert.equal(result.data.name, "Widget 1");
  assert.equal(browserCreated, true);
  assert.deepEqual(analyzedTitles, [
    "Loading...",
    "Widget 1 - 立即购买"
  ]);
});

test("runCrawlerWorkflow keeps readable mirror out of the initial path when a browser is available", async () => {
  let mirrorCalls = 0;
  const session = createFakeSession({
    snapshot: {
      url: "https://example.com/products/widget-1",
      title: "Widget 1 - 立即购买",
      visibleText: "Widget 1 售价 99 元，库存充足。",
      headings: ["Widget 1"],
      buttonTexts: ["加入购物车"],
      iframeSources: [],
      sectionCandidates: [
        {
          selector: ".product-detail",
          textSample: "Widget 1 售价 99 元，库存充足。"
        }
      ]
    },
    sections: [
      {
        selector: ".product-detail",
        text: "Widget 1 售价 99 元，库存充足。"
      }
    ]
  });

  const result = await runCrawlerWorkflow({
    session: null,
    getSession: async () => session,
    initialSnapshotProvider: {
      async fetch() {
        return null;
      }
    },
    fallbackSnapshotProvider: {
      async fetch() {
        mirrorCalls += 1;

        return {
          source: "readable_mirror",
          snapshot: {
            url: "https://example.com/products/widget-1",
            title: "Widget 1 - mirror",
            headings: ["Widget 1"],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [],
            visibleText: "mirror content",
            fullVisibleText: "mirror content"
          }
        };
      }
    },
    aiClient: {
      async analyzeStructure({ snapshot }) {
        assert.equal(snapshot.title, "Widget 1 - 立即购买");

        return {
          targetSectionSelectors: [".product-detail"],
          extractionMode: "sections",
          outputShape: "object"
        };
      },
      async extractContent({ sections }) {
        assert.equal(sections.length, 1);

        return {
          answer: {
            name: "Widget 1"
          },
          confidence: 0.95
        };
      }
    },
    url: "https://example.com/products/widget-1",
    userQuery: "提取商品标题"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "browser");
  assert.equal(result.data.name, "Widget 1");
  assert.equal(mirrorCalls, 0);
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

test("runCrawlerWorkflow can continue with a fallback snapshot provider when no browser session is available", async () => {
  let fallbackCalls = 0;
  let intentCalled = false;
  let analyzeCalled = false;
  const registry = new SkillRegistry();
  registerBuiltInSkills(registry);

  const result = await runCrawlerWorkflow({
    session: null,
    registry,
    aiClient: {
      async analyzeUserIntent() {
        intentCalled = true;
        throw new Error("analyzeUserIntent should not be called for obvious article queries");
      },
      async analyzeStructure({ snapshot }) {
        analyzeCalled = true;
        assert.match(snapshot.fullVisibleText, /Python 里的混沌 Hello World/u);

        return {
          targetSectionSelectors: ["body"],
          extractionMode: "sections",
          outputShape: "object"
        };
      },
      async extractContent({ snapshot, plan, extractionPrompt }) {
        assert.match(snapshot.fullVisibleText, /Python 里的混沌 Hello World/u);
        assert.equal(plan.extractionMode, "sections");
        assert.equal(plan.outputShape, "object");
        assert.match(extractionPrompt, /这是一个文章、博客或新闻内容页/u);

        return {
          answer: {
            title: "Python 里的混沌 Hello World",
            author: "Evalbug"
          },
          confidence: 0.93
        };
      }
    },
    fallbackSnapshotProvider: {
      async fetch({ url, blockedSnapshot, browserError }) {
        fallbackCalls += 1;
        assert.equal(url, "https://blog.evalbug.com/2015/11/05/python_chaos_hello_world/");
        assert.equal(blockedSnapshot, null);
        assert.match(browserError.message, /browser session is unavailable/i);

        return {
          source: "http_fetch",
          snapshot: {
            url,
            title: "Python 里的混沌 Hello World",
            metaDescription: "",
            headings: ["Python 里的混沌 Hello World"],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [
              {
                selector: "body",
                tagName: "body",
                textSample: "Python 里的混沌 Hello World..."
              }
            ],
            visibleText: "Python 里的混沌 Hello World",
            fullVisibleText: "Python 里的混沌 Hello World\n\n作者 Evalbug"
          },
          async collectSections() {
            return [
              {
                selector: "body",
                text: "Python 里的混沌 Hello World\n\n作者 Evalbug"
              }
            ];
          }
        };
      }
    },
    url: "https://blog.evalbug.com/2015/11/05/python_chaos_hello_world/",
    userQuery: "获取这篇博客的内容"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "http_fetch");
  assert.equal(result.data.title, "Python 里的混沌 Hello World");
  assert.equal(fallbackCalls, 1);
  assert.equal(intentCalled, false);
  assert.equal(analyzeCalled, true);
});

test("runCrawlerWorkflow falls back when browser navigation crashes before a snapshot is captured", async () => {
  const session = createFakeSession({
    navigateError: new Error("browserType.launch: Target page, context or browser has been closed")
  });

  let fallbackCalls = 0;

  const result = await runCrawlerWorkflow({
    session,
    aiClient: {
      async analyzeStructure({ snapshot }) {
        assert.equal(snapshot.title, "Python 里的混沌 Hello World");

        return {
          targetSectionSelectors: [],
          extractionMode: "full_text",
          outputShape: "object"
        };
      },
      async extractContent() {
        return {
          answer: {
            title: "Python 里的混沌 Hello World"
          },
          confidence: 0.9
        };
      }
    },
    fallbackSnapshotProvider: {
      async fetch({ url, blockedSnapshot, browserError }) {
        fallbackCalls += 1;
        assert.equal(url, "https://blog.evalbug.com/2015/11/05/python_chaos_hello_world/");
        assert.equal(blockedSnapshot, null);
        assert.match(browserError.message, /Target page, context or browser has been closed/u);

        return {
          source: "http_fetch",
          snapshot: {
            url,
            title: "Python 里的混沌 Hello World",
            metaDescription: "",
            headings: ["Python 里的混沌 Hello World"],
            buttonTexts: [],
            iframeSources: [],
            sectionCandidates: [],
            visibleText: "Python 里的混沌 Hello World",
            fullVisibleText: "Python 里的混沌 Hello World"
          },
          async collectSections() {
            return [
              {
                selector: "body",
                text: "Python 里的混沌 Hello World"
              }
            ];
          }
        };
      }
    },
    url: "https://blog.evalbug.com/2015/11/05/python_chaos_hello_world/",
    userQuery: "获取这篇博客的内容"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.contentSource, "http_fetch");
  assert.equal(result.data.title, "Python 里的混沌 Hello World");
  assert.equal(fallbackCalls, 1);
  assert.equal(session.closeCalls, 1);
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
