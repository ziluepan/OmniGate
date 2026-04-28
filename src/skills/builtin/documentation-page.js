import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  PRE_ACTIONS,
  WAIT_TYPES
} from "../types.js";

const DOCS_URL_PATTERNS = [
  /\/docs\//iu,
  /\/doc\//iu,
  /\/guide\//iu,
  /\/guides\//iu,
  /\/reference\//iu,
  /\/api\//iu,
  /\/manual\//iu,
  /\/handbook\//iu
];

const DOCS_QUERY_KEYWORDS = [
  "文档",
  "说明",
  "指南",
  "教程",
  "api",
  "参数",
  "用法",
  "示例",
  "reference",
  "guide",
  "docs"
];

export const documentationPageSkill = {
  name: "documentation-page",
  description:
    "文档/API 页面提取，适合提取用法、参数、步骤、代码示例和注意事项",
  priority: 80,
  tags: ["content", "docs", "api"],

  matchIntent(userQuery, snapshot) {
    const url = snapshot?.url ?? "";
    const title = snapshot?.title ?? "";
    const query = userQuery.toLowerCase();
    const urlMatch = DOCS_URL_PATTERNS.some((pattern) => pattern.test(url));
    const titleMatch = /docs|documentation|guide|reference|api|教程|指南|文档/iu.test(
      title
    );
    const queryMatch = DOCS_QUERY_KEYWORDS.some((keyword) =>
      query.includes(keyword.toLowerCase())
    );

    return {
      match: urlMatch || titleMatch || queryMatch
    };
  },

  waitStrategy: {
    type: WAIT_TYPES.SELECTOR,
    selector:
      "main, article, .markdown-body, .theme-doc-markdown, .content, .doc-content",
    timeout: 12000
  },

  preActions: [PRE_ACTIONS.DISMISS_OVERLAYS],

  extractStrategy: {
    selectors: [
      "main article",
      "article",
      ".markdown-body",
      ".theme-doc-markdown",
      ".doc-content",
      ".content",
      ".prose"
    ],
    mode: EXTRACTION_MODES.SECTIONS,
    outputShape: OUTPUT_SHAPES.OBJECT
  },

  extractionPrompt: [
    "这是一个文档、指南或 API 参考页面。",
    "请优先提取页面标题、适用场景、关键步骤、参数/API 字段、代码示例和注意事项。",
    "如果用户是在问“怎么用”，请保留操作顺序。"
  ].join("\n"),

  postProcess(rawText) {
    return rawText.trim();
  }
};
