export const TASK_TOOL_NAMES = Object.freeze({
  AUTO: "auto",
  EXTRACT: "extract",
  FULL_CONTENT: "full_content",
  LINKS: "links",
  CRAWL: "crawl"
});

const SITE_WIDE_PATTERN =
  /(整个网站|整站|全站|站内所有|汇总.*站内|汇总.*全站|多页|所有页面|全部页面|全站文章|站点地图|crawl)/iu;
const FULL_CONTENT_PATTERN =
  /(full\s+content|原文|全文|完整正文|完整内容|直接返回|不要总结|不要提炼|full[-_\s]?text)/iu;

export function normalizeTaskToolName(rawTool) {
  if (typeof rawTool !== "string") {
    return null;
  }

  const normalizedTool = rawTool.trim().toLowerCase().replace(/-/gu, "_");

  if (Object.values(TASK_TOOL_NAMES).includes(normalizedTool)) {
    return normalizedTool;
  }

  return null;
}

export function decideTaskTool({
  userQuery,
  explicitTool,
  crawl = false,
  fullContent = false
}) {
  const normalizedExplicitTool = normalizeTaskToolName(explicitTool);

  if (normalizedExplicitTool && normalizedExplicitTool !== TASK_TOOL_NAMES.AUTO) {
    return {
      tool: normalizedExplicitTool,
      source: "explicit",
      reason: "Explicit tool override provided by the caller."
    };
  }

  if (crawl) {
    return {
      tool: TASK_TOOL_NAMES.CRAWL,
      source: "flag",
      reason: "Legacy crawl flag requested a site-wide crawl."
    };
  }

  if (fullContent) {
    return {
      tool: TASK_TOOL_NAMES.FULL_CONTENT,
      source: "flag",
      reason: "Legacy full-content flag requested raw page content."
    };
  }

  const normalizedQuery = typeof userQuery === "string" ? userQuery.trim() : "";

  if (SITE_WIDE_PATTERN.test(normalizedQuery)) {
    return {
      tool: TASK_TOOL_NAMES.CRAWL,
      source: "heuristic",
      reason: "The query asks for site-wide or multi-page coverage."
    };
  }

  if (FULL_CONTENT_PATTERN.test(normalizedQuery)) {
    return {
      tool: TASK_TOOL_NAMES.FULL_CONTENT,
      source: "heuristic",
      reason: "The query asks for the original full content without synthesis."
    };
  }

  return {
    tool: TASK_TOOL_NAMES.EXTRACT,
    source: "default",
    reason: "Default single-page extraction tool."
  };
}
