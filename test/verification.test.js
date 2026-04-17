import test from "node:test";
import assert from "node:assert/strict";

import { detectVerificationSignals } from "../src/verification.js";

test("detectVerificationSignals flags common anti-bot challenge pages", () => {
  const result = detectVerificationSignals({
    title: "Just a moment...",
    visibleText:
      "Verify you are human to continue. Complete the CAPTCHA challenge before accessing this page.",
    headings: ["Security check"],
    buttonTexts: ["Verify you are human"],
    iframeSources: ["https://challenges.cloudflare.com/challenge-platform/h/b/orchestrate"]
  });

  assert.equal(result.blocked, true);
  assert.ok(result.signals.length >= 2);
  assert.match(result.reason, /verification/i);
});

test("detectVerificationSignals does not block normal content pages", () => {
  const result = detectVerificationSignals({
    title: "AI 爬虫示例页面",
    visibleText:
      "这里展示产品标题、价格和详细参数。欢迎查看公开页面内容。",
    headings: ["商品详情"],
    buttonTexts: ["加入购物车"],
    iframeSources: []
  });

  assert.equal(result.blocked, false);
  assert.equal(result.signals.length, 0);
});
