import test from "node:test";
import assert from "node:assert/strict";

import { registerBuiltInSkills } from "../src/skills/bootstrap.js";
import { articlePageSkill } from "../src/skills/builtin/article-page.js";
import { discussionThreadSkill } from "../src/skills/builtin/discussion-thread.js";
import { documentationPageSkill } from "../src/skills/builtin/documentation-page.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { genericPageSkill } from "../src/skills/builtin/generic-page.js";
import { listingPageSkill } from "../src/skills/builtin/listing-page.js";
import { novelChapterSkill } from "../src/skills/builtin/novel-chapter.js";
import { productDetailSkill } from "../src/skills/builtin/product-detail.js";
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
  registry.register(productDetailSkill);
  registry.register(genericPageSkill);

  const descriptions = registry.getSkillDescriptions();

  assert.equal(descriptions.length, 3);
  assert.equal(descriptions[0].name, "novel-chapter");
  assert.equal(descriptions[1].name, "product-detail");
  assert.equal(descriptions[2].name, "generic-page");
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
  registry.register(productDetailSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "提取页面里的普通信息",
    snapshot: {
      url: "https://example.com/about",
      title: "About Us"
    }
  });

  assert.ok(match.skill !== null);
  assert.equal(match.skill.name, "generic-page");
});

test("SkillRegistry.matchIntent selects product-detail for product pages", () => {
  const registry = new SkillRegistry();

  registry.register(productDetailSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "提取商品价格、规格和库存",
    snapshot: {
      url: "https://example.com/products/widget-1",
      title: "Widget 1 - 立即购买"
    }
  });

  assert.equal(match.skill.name, "product-detail");
});

test("SkillRegistry.matchIntent selects documentation-page for docs pages", () => {
  const registry = new SkillRegistry();

  registry.register(documentationPageSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "总结这个 API 的参数和示例",
    snapshot: {
      url: "https://example.com/docs/auth/login",
      title: "Authentication API Reference"
    }
  });

  assert.equal(match.skill.name, "documentation-page");
});

test("SkillRegistry.matchIntent selects article-page for article pages", () => {
  const registry = new SkillRegistry();

  registry.register(articlePageSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "提取作者、发布时间和正文要点",
    snapshot: {
      url: "https://example.com/blog/new-release",
      title: "New Release Blog Post"
    }
  });

  assert.equal(match.skill.name, "article-page");
});

test("SkillRegistry.matchIntent selects discussion-thread for forum topics", () => {
  const registry = new SkillRegistry();

  registry.register(discussionThreadSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "总结楼主的问题和高质量回复",
    snapshot: {
      url: "https://forum.example.com/thread/123",
      title: "Question about deployment"
    }
  });

  assert.equal(match.skill.name, "discussion-thread");
});

test("SkillRegistry.matchIntent uses priority to prefer listing-page over product-detail", () => {
  const registry = new SkillRegistry();

  registry.register(productDetailSkill);
  registry.register(listingPageSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "列出这个页面里所有商品和价格",
    snapshot: {
      url: "https://example.com/products",
      title: "Product Catalog"
    }
  });

  assert.equal(match.skill.name, "listing-page");
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

test("SkillRegistry does not let generic-page LLM intent shadow specific rule matches", () => {
  const registry = new SkillRegistry();

  registry.register(productDetailSkill);
  registry.register(genericPageSkill);

  const match = registry.matchIntent({
    userQuery: "提取商品价格",
    snapshot: {
      url: "https://example.com/products/123",
      title: "Product Page"
    },
    llmIntent: { skill: "generic-page", confidence: 0.4, params: {} }
  });

  assert.equal(match.skill.name, "product-detail");
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

test("registerBuiltInSkills registers all built-in content and verification skills", () => {
  const registry = new SkillRegistry();

  registerBuiltInSkills(registry);

  assert.ok(registry.getSkill("listing-page"));
  assert.ok(registry.getSkill("product-detail"));
  assert.ok(registry.getSkill("documentation-page"));
  assert.ok(registry.getSkill("article-page"));
  assert.ok(registry.getSkill("discussion-thread"));
  assert.ok(registry.getSkill("novel-chapter"));
  assert.ok(registry.getSkill("generic-page"));
  assert.equal(registry.verificationSkills.length, 3);
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

test("redirect verification skill does not flag article pages that merely contain login links", () => {
  const detected = redirectVerificationSkill.detect({
    title: "一世之尊-第732章 无耻小孟（求月票）-69书吧",
    headings: ["第732章 无耻小孟（求月票）"],
    visibleText:
      "首页 登录 注册\n第732章 无耻小孟（求月票）\n这是正文第一段。\n这是正文第二段。",
    fullVisibleText:
      "首页 登录 注册\n\n第732章 无耻小孟（求月票）\n\n这是正文第一段。\n\n这是正文第二段。",
    sectionCandidates: [
      {
        selector: "article",
        textSample: "这是正文第一段。"
      }
    ]
  });

  assert.equal(detected.blocked, false);
});

test("redirect verification skill still flags thin login walls even if the title looks normal", () => {
  const detected = redirectVerificationSkill.detect({
    title: "一世之尊-第732章 无耻小孟（求月票）-69书吧",
    headings: ["第732章 无耻小孟（求月票）"],
    visibleText: "请先登录后继续阅读本章内容。",
    fullVisibleText: "请先登录后继续阅读本章内容。",
    sectionCandidates: []
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
