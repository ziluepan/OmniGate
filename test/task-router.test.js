import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_TOOL_NAMES,
  decideTaskTool
} from "../src/task-router.js";

test("decideTaskTool respects explicit tool overrides", () => {
  const decision = decideTaskTool({
    userQuery: "提取内容",
    explicitTool: TASK_TOOL_NAMES.LINKS
  });

  assert.deepEqual(decision, {
    tool: TASK_TOOL_NAMES.LINKS,
    source: "explicit",
    reason: "Explicit tool override provided by the caller."
  });
});

test("decideTaskTool keeps backwards-compatible crawl and full-content flags", () => {
  const crawlDecision = decideTaskTool({
    userQuery: "提取内容",
    crawl: true
  });
  const fullContentDecision = decideTaskTool({
    userQuery: "提取内容",
    fullContent: true
  });

  assert.equal(crawlDecision.tool, TASK_TOOL_NAMES.CRAWL);
  assert.equal(crawlDecision.source, "flag");
  assert.equal(fullContentDecision.tool, TASK_TOOL_NAMES.FULL_CONTENT);
  assert.equal(fullContentDecision.source, "flag");
});

test("decideTaskTool keeps AI extraction as the default for link-oriented queries", () => {
  const decision = decideTaskTool({
    userQuery: "列出这个页面里的所有链接"
  });

  assert.deepEqual(decision, {
    tool: TASK_TOOL_NAMES.EXTRACT,
    source: "default",
    reason: "Default single-page extraction tool."
  });
});

test("decideTaskTool auto-routes site-level aggregation requests to crawl", () => {
  const decision = decideTaskTool({
    userQuery: "汇总站内所有文章标题和摘要"
  });

  assert.deepEqual(decision, {
    tool: TASK_TOOL_NAMES.CRAWL,
    source: "heuristic",
    reason: "The query asks for site-wide or multi-page coverage."
  });
});

test("decideTaskTool auto-routes raw-content requests to full content", () => {
  const decision = decideTaskTool({
    userQuery: "直接返回这页的完整正文，不要总结"
  });

  assert.deepEqual(decision, {
    tool: TASK_TOOL_NAMES.FULL_CONTENT,
    source: "heuristic",
    reason: "The query asks for the original full content without synthesis."
  });
});

test("decideTaskTool falls back to extract for normal page understanding requests", () => {
  const decision = decideTaskTool({
    userQuery: "提取商品标题、价格和卖点"
  });

  assert.deepEqual(decision, {
    tool: TASK_TOOL_NAMES.EXTRACT,
    source: "default",
    reason: "Default single-page extraction tool."
  });
});
