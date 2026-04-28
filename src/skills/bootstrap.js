import { articlePageSkill } from "./builtin/article-page.js";
import { discussionThreadSkill } from "./builtin/discussion-thread.js";
import { documentationPageSkill } from "./builtin/documentation-page.js";
import { genericPageSkill } from "./builtin/generic-page.js";
import { listingPageSkill } from "./builtin/listing-page.js";
import { novelChapterSkill } from "./builtin/novel-chapter.js";
import { productDetailSkill } from "./builtin/product-detail.js";
import { captchaVerificationSkill } from "./verification/captcha.js";
import { cloudflareVerificationSkill } from "./verification/cloudflare.js";
import { redirectVerificationSkill } from "./verification/redirect.js";

export const BUILTIN_CONTENT_SKILLS = Object.freeze([
  listingPageSkill,
  productDetailSkill,
  documentationPageSkill,
  articlePageSkill,
  discussionThreadSkill,
  novelChapterSkill,
  genericPageSkill
]);

export const BUILTIN_VERIFICATION_SKILLS = Object.freeze([
  cloudflareVerificationSkill,
  captchaVerificationSkill,
  redirectVerificationSkill
]);

export function registerBuiltInSkills(registry) {
  for (const skill of BUILTIN_CONTENT_SKILLS) {
    registry.register(skill);
  }

  for (const skill of BUILTIN_VERIFICATION_SKILLS) {
    registry.registerVerification(skill);
  }

  return registry;
}
