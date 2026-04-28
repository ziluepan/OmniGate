import test from "node:test";
import assert from "node:assert/strict";

import { SkillRegistry } from "../src/skills/registry.js";
import { novelChapterSkill } from "../src/skills/builtin/novel-chapter.js";
import { genericPageSkill } from "../src/skills/builtin/generic-page.js";
import { cloudflareVerificationSkill } from "../src/skills/verification/cloudflare.js";
import { captchaVerificationSkill } from "../src/skills/verification/captcha.js";
import { redirectVerificationSkill } from "../src/skills/verification/redirect.js";

test("SkillRegistry registers skills without duplicates", () => {
  const registry = new SkillRegistry();

  registry.register(novelChapterSkill);
  registry.register(novelChapterSkill);
  registry.register(genericPageSkill);

  assert.equal(registry.skills.length, 2);
});

test("SkillRegistry.getSkillDescriptions returns names and descriptions", () => {
  const registry = new SkillRegistry();

  registry.register(novelChapterSkill);
  registry.register(genericPageSkill);

  const descriptions = registry.getSkillDescriptions();

  assert.equal(descriptions.length, 2);
  assert.equal(descriptions[0].name, "novel-chapter");
  assert.equal(descriptions[1].name, "generic-page");
});

test("SkillRegistry.matchIntent selects novel-chapter for novel URL", () => {
  const registry = new SkillRegistry();

  registry.register(novelChapterSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "把这章的小说内容给我",
    snapshot: {
      url: "https://www.69shuba.com/txt/15054/29814105",
      title: "章节标题"
    }
  });

  assert.ok(match.skill !== null);
  assert.equal(match.skill.name, "novel-chapter");
});

test("SkillRegistry.matchIntent falls back to generic-page for unknown URL", () => {
  const registry = new SkillRegistry();

  registry.register(novelChapterSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "提取商品信息",
    snapshot: {
      url: "https://example.com/products/123",
      title: "Product Page"
    }
  });

  assert.ok(match.skill !== null);
  assert.equal(match.skill.name, "generic-page");
});

test("SkillRegistry.matchIntent uses LLM intent result when provided", () => {
  const registry = new SkillRegistry();

  registry.register(novelChapterSkill);
  registry.register(genericPageSkill);

  // Even with a non-novel URL, if LLM says novel-chapter, use it
  const match = registry.matchIntent({
    userQuery: "提取商品",
    snapshot: {
      url: "https://example.com/products/123",
      title: "Product Page"
    },
    llmIntent: { skill: "novel-chapter", confidence: 0.9, params: {} }
  });

  assert.equal(match.skill.name, "novel-chapter");
});

test("SkillRegistry.matchIntent handles invalid LLM skill name gracefully", () => {
  const registry = new SkillRegistry();

  registry.register(genericPageSkill);

  // LLM suggests a non-existent skill
  const match = registry.matchIntent({
    userQuery: "随便",
    snapshot: { url: "https://example.com" },
    llmIntent: { skill: "non-existent", confidence: 0.9, params: {} }
  });

  assert.equal(match.skill.name, "generic-page");
});

test("novel-chapter skill matches novel URLs and queries", () => {
  // Match: URL + query both novel-like
  const result1 = novelChapterSkill.matchIntent(
    "把这章的小说内容给我",
    { url: "https://www.69shuba.com/txt/15054/29814105" }
  );
  assert.equal(result1.match, true);

  // Match: URL alone is novel-like
  const result2 = novelChapterSkill.matchIntent(
    "提取信息",
    { url: "https://www.69shuba.com/txt/15054/29814105" }
  );
  assert.equal(result2.match, true);

  // No match: non-novel URL and non-novel query
  const result3 = novelChapterSkill.matchIntent(
    "提取商品标题",
    { url: "https://example.com/products/123" }
  );
  assert.equal(result3.match, false);
});

test("generic-page skill matches everything", () => {
  const result = genericPageSkill.matchIntent(
    "任何查询",
    { url: "https://any-site.com" }
  );
  assert.equal(result.match, true);
});

test("cloudflare verification skill detects CF pages", () => {
  const detected = cloudflareVerificationSkill.detect({
    title: "Just a moment...",
    visibleText: "Checking your browser before accessing the site. DDoS protection by Cloudflare."
  });

  assert.equal(detected.blocked, true);
  assert.equal(detected.type, "cloudflare");
});

test("cloudflare verification skill does not flag normal pages", () => {
  const detected = cloudflareVerificationSkill.detect({
    title: "Normal Page",
    visibleText: "Welcome to our website. Here is the content you requested."
  });

  assert.equal(detected.blocked, false);
});

test("captcha verification skill detects captcha pages", () => {
  const detected = captchaVerificationSkill.detect({
    title: "人机验证",
    visibleText: "请完成验证",
    iframeSources: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/..."]
  });

  assert.equal(detected.blocked, true);
  assert.equal(detected.type, "captcha");
});

test("captcha verification skill does not flag normal pages", () => {
  const detected = captchaVerificationSkill.detect({
    title: "Article",
    visibleText: "Lorem ipsum dolor sit amet."
  });

  assert.equal(detected.blocked, false);
});

test("redirect verification skill detects login/404 pages", () => {
  const detected = redirectVerificationSkill.detect({
    title: "请登录",
    visibleText: "您需要登录后才能访问此页面。"
  });

  assert.equal(detected.blocked, true);
  assert.equal(detected.type, "redirect");
});

test("SkillRegistry.detectVerification returns CF verification for CF pages", () => {
  const registry = new SkillRegistry();

  registry.registerVerification(cloudflareVerificationSkill);
  registry.registerVerification(captchaVerificationSkill);
  registry.registerVerification(redirectVerificationSkill);

  const result = registry.detectVerification({
    title: "Just a moment...",
    visibleText: "Checking your browser before accessing the site."
  });

  assert.equal(result.blocked, true);
  assert.equal(result.type, "cloudflare");
  assert.ok(result.handler !== null);
});

test("SkillRegistry.detectVerification returns not blocked for clean pages", () => {
  const registry = new SkillRegistry();

  registry.registerVerification(cloudflareVerificationSkill);
  registry.registerVerification(captchaVerificationSkill);

  const result = registry.detectVerification({
    title: "Hello",
    visibleText: "Normal content"
  });

  assert.equal(result.blocked, false);
});
