import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  PRE_ACTIONS,
  WAIT_TYPES
} from "../types.js";

const LISTING_URL_PATTERNS = [
  /\/search/iu,
  /\/category/iu,
  /\/collections?\//iu,
  /\/catalog/iu,
  /\/listing/iu,
  /\/tags?\//iu,
  /\/results?/iu
];

const LISTING_QUERY_KEYWORDS = [
  "列表",
  "列出",
  "所有商品",
  "搜索结果",
  "目录",
  "清单",
  "全部文章",
  "全部项目",
  "catalog",
  "listing",
  "results"
];

export const listingPageSkill = {
  name: "listing-page",
  description:
    "列表/搜索结果页提取，适合批量提取卡片标题、链接、价格、摘要等数组结果",
  priority: 90,
  tags: ["content", "listing", "search-results"],

  matchIntent(userQuery, snapshot) {
    const url = snapshot?.url ?? "";
    const title = snapshot?.title ?? "";
    const query = userQuery.toLowerCase();
    const urlMatch = LISTING_URL_PATTERNS.some((pattern) => pattern.test(url));
    const titleMatch = /搜索结果|results|catalog|目录|列表|分类/iu.test(title);
    const queryMatch = LISTING_QUERY_KEYWORDS.some((keyword) =>
      query.includes(keyword.toLowerCase())
    );

    return {
      match: urlMatch || titleMatch || queryMatch
    };
  },

  waitStrategy: {
    type: WAIT_TYPES.SELECTOR,
    selector:
      "main, .list, .listing, .search-results, ul, ol, [role='list']",
    timeout: 12000
  },

  preActions: [
    PRE_ACTIONS.DISMISS_OVERLAYS,
    PRE_ACTIONS.WAIT_FOR_LAZY_LOAD
  ],

  extractStrategy: {
    selectors: [
      ".search-results",
      ".listing",
      ".list",
      "[role='list']",
      "main",
      "ul",
      "ol",
      ".products",
      ".articles"
    ],
    mode: EXTRACTION_MODES.SECTIONS,
    outputShape: OUTPUT_SHAPES.ARRAY
  },

  extractionPrompt: [
    "这是一个列表页、目录页或搜索结果页。",
    "请按列表项输出数组，每一项尽量提取标题、链接、价格、标签、摘要或其他列表中稳定出现的字段。",
    "不要把页面导航和筛选器当成结果项。"
  ].join("\n"),

  postProcess(rawText) {
    return rawText.trim();
  }
};
