import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  PRE_ACTIONS,
  WAIT_TYPES
} from "../types.js";

const THREAD_URL_PATTERNS = [
  /\/thread\//iu,
  /\/threads\//iu,
  /\/topic\//iu,
  /\/question\//iu,
  /\/questions\//iu,
  /\/discuss\//iu,
  /\/forum\//iu
];

const THREAD_QUERY_KEYWORDS = [
  "帖子",
  "讨论",
  "问答",
  "回答",
  "回复",
  "楼主",
  "评论",
  "thread",
  "topic",
  "question"
];

export const discussionThreadSkill = {
  name: "discussion-thread",
  description:
    "论坛帖子/问答讨论页提取，适合楼主内容、最佳回答、回复摘要和结论",
  priority: 68,
  tags: ["content", "forum", "thread", "qa"],

  matchIntent(userQuery, snapshot) {
    const url = snapshot?.url ?? "";
    const title = snapshot?.title ?? "";
    const query = userQuery.toLowerCase();
    const urlMatch = THREAD_URL_PATTERNS.some((pattern) => pattern.test(url));
    const titleMatch = /question|thread|topic|forum|讨论|问答|帖子/iu.test(title);
    const queryMatch = THREAD_QUERY_KEYWORDS.some((keyword) =>
      query.includes(keyword.toLowerCase())
    );

    return {
      match: urlMatch || titleMatch || queryMatch
    };
  },

  waitStrategy: {
    type: WAIT_TYPES.SELECTOR,
    selector:
      "main, article, .thread, .topic, .question, .post, .comments, .answers",
    timeout: 12000
  },

  preActions: [PRE_ACTIONS.DISMISS_OVERLAYS],

  extractStrategy: {
    selectors: [
      ".thread",
      ".topic",
      ".question",
      ".post",
      ".discussion",
      ".answers",
      ".comments",
      "main"
    ],
    mode: EXTRACTION_MODES.SECTIONS,
    outputShape: OUTPUT_SHAPES.OBJECT
  },

  extractionPrompt: [
    "这是一个讨论帖、论坛帖子或问答页面。",
    "请优先提取主题标题、楼主/问题描述、最佳回答或高质量回复、主要观点分歧和结论。",
    "如果回复很多，请总结回复结构，不要逐条机械展开。"
  ].join("\n"),

  postProcess(rawText) {
    return rawText.trim();
  }
};
