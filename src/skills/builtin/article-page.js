import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  PRE_ACTIONS,
  WAIT_TYPES
} from "../types.js";

const ARTICLE_URL_PATTERNS = [
  /\/article\//iu,
  /\/articles\//iu,
  /\/blog\//iu,
  /\/news\//iu,
  /\/post\//iu,
  /\/posts\//iu,
  /\/story\//iu
];

const ARTICLE_QUERY_KEYWORDS = [
  "文章",
  "博客",
  "新闻",
  "正文",
  "作者",
  "发布时间",
  "总结",
  "摘要",
  "原文",
  "post",
  "article",
  "blog",
  "news"
];

export const articlePageSkill = {
  name: "article-page",
  description:
    "文章/博客/新闻正文提取，适合需要标题、作者、发布时间、正文和摘要的内容页",
  priority: 70,
  tags: ["content", "article", "blog", "news"],

  matchIntent(userQuery, snapshot) {
    const url = snapshot?.url ?? "";
    const title = snapshot?.title ?? "";
    const query = userQuery.toLowerCase();
    const urlMatch = ARTICLE_URL_PATTERNS.some((pattern) => pattern.test(url));
    const titleMatch = /blog|news|article|专栏|快讯|报道|教程|指南/iu.test(title);
    const queryMatch = ARTICLE_QUERY_KEYWORDS.some((keyword) =>
      query.includes(keyword.toLowerCase())
    );

    return {
      match: urlMatch || titleMatch || queryMatch
    };
  },

  waitStrategy: {
    type: WAIT_TYPES.SELECTOR,
    selector:
      "article, main article, .article, .post-content, .entry-content, .markdown-body",
    timeout: 12000
  },

  preActions: [PRE_ACTIONS.DISMISS_OVERLAYS],

  extractStrategy: {
    selectors: [
      "article",
      "main article",
      ".article",
      ".article-content",
      ".post-content",
      ".entry-content",
      ".markdown-body",
      "[itemprop='articleBody']"
    ],
    mode: EXTRACTION_MODES.SECTIONS,
    outputShape: OUTPUT_SHAPES.OBJECT
  },

  extractionPrompt: [
    "这是一个文章、博客或新闻内容页。",
    "请优先提取标题、副标题、作者、发布时间、正文摘要和正文要点。",
    "如果用户要求正文，请尽量保留文章结构，不要混入推荐阅读、评论区和侧栏内容。"
  ].join("\n"),

  postProcess(rawText) {
    return rawText.trim();
  }
};
