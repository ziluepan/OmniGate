/**
 * novel-chapter skill
 *
 * 专门处理小说章节页面的抓取。
 * 适用于 69shuba、笔趣阁等中文小说站点。
 * 核心特点：全文提取，不做结构化处理，保持章节内容完整性。
 */

import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  WAIT_TYPES,
  PRE_ACTIONS
} from "../types.js";

const NOVEL_PATTERNS = [
  /\u006e\u006f\u0076\u0065\u006c/i,        // novel
  /\u0073\u0068\u0075\u0062\u0061/i,        // shuba
  /\u0062\u0069\u0071\u0075\u0067\u0065/i,  // biquge
  /\u0078\u0069\u0061\u006f\u0073\u0068\u0075\u006f/i, // xiaoshuo (pinyin)
  /\u0077\u0065\u006e\u0078\u0075\u0065/i,  // wenxue (pinyin)
  /\u0074\u0078\u0074\//i,                  // /txt/
  /\u0062\u006f\u006f\u006b\//i,            // /book/
  /\u0063\u0068\u0061\u0070\u0074\u0065\u0072/i // chapter
];

// 中文关键词 - using Unicode escapes to avoid encoding issues
const CN_CHAPTER_KEYWORDS = [
  "\u7b2c",     // 第
  "\u7ae0",     // 章
  "\u5c0f\u8bf4", // 小说
  "\u7ae0\u8282", // 章节
  "\u66f4\u65b0", // 更新
  "\u4f5c\u8005", // 作者
  "\u4e66\u9875", // 书页
  "\u7f51\u9875", // 网页
  "\u6b63\u6587", // 正文
];

export const novelChapterSkill = {
  name: "novel-chapter",
  description:
    "小说章节内容提取 — 适合中文小说站点（69shuba、笔趣阁等），全文原样返回",

  /**
   * 意图匹配：检查 URL 和用户查询是否包含小说相关特征
   */
  matchIntent(userQuery, snapshot) {
    const url = snapshot?.url ?? "";
    const urlLower = url.toLowerCase();
    const queryLower = userQuery.toLowerCase();

    // 检查 URL 是否匹配小说站点特征
    const urlMatch = NOVEL_PATTERNS.some((pattern) => pattern.test(urlLower));

    // 检查用户查询是否包含小说相关关键词
    const queryMatch = [
      "\u5c0f\u8bf4",       // 小说
      "\u7ae0\u8282",       // 章节
      "\u6b63\u6587",       // 正文
      "\u5185\u5bb9",       // 内容
      "\u7ed9\u6211",       // 给我
      "chapter",
      "novel",
      "\u539f\u6837",       // 原样
      "\u76f4\u63a5\u8fd4\u56de", // 直接返回
      "\u5168\u90e8",       // 全部
    ].some((kw) => queryLower.includes(kw));

    if (urlMatch && queryMatch) {
      return { match: true, params: {} };
    }

    // 如果 URL 匹配但 query 不明显，仍然匹配
    if (urlMatch) {
      return { match: true, params: {} };
    }

    return { match: false };
  },

  /**
   * 等待策略：等 .content 或 #content 或 article 出现
   */
  waitStrategy: {
    type: WAIT_TYPES.SELECTOR,
    selector: ".content, #content, .txt, .chapter-content, article, .novel-content, .book-content",
    timeout: 15000
  },

  /**
   * 预处理动作：滚动到页面底部触发懒加载，然后关掉遮罩
   */
  preActions: [PRE_ACTIONS.SCROLL_TO_BOTTOM, PRE_ACTIONS.DISMISS_OVERLAYS],

  /**
   * 提取策略：全文提取，以纯文本输出
   */
  extractStrategy: {
    selectors: [
      ".content",
      "#content",
      ".txt",
      ".chapter-content",
      ".novel-content",
      ".book-content",
      ".article-content",
      "#chaptercontent",
      "article",
      ".read-content",
      ".post-content"
    ],
    mode: EXTRACTION_MODES.FULL_TEXT,
    outputShape: OUTPUT_SHAPES.TEXT
  },

  /**
   * LLM 提取时的额外提示
   */
  extractionPrompt: [
    "这是一篇小说章节内容页面。",
    "请原样返回章节正文，不要总结、不要省略、不要改写。",
    "保留原文的段落结构和标点符号。",
    "忽略导航栏、评论区、广告等非正文内容。"
  ].join("\n"),

  /**
   * 输出后处理：去除首尾空白，保留段落结构
   */
  postProcess(rawText) {
    return rawText.trim();
  }
};
