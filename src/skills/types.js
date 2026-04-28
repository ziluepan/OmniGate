/**
 * Skill 接口定义
 *
 * 每个 skill 描述一种页面抓取策略，包括导航、提取、输出格式等。
 * SkillRegistry 根据用户意图和页面特征匹配合适的 skill。
 */

/**
 * @typedef {Object} WaitStrategy
 * @property {"selector"|"time"|"load"} type - 等待策略类型
 * @property {string} [selector] - type=selector 时的 CSS 选择器
 * @property {number} [timeout] - 超时时间（毫秒）
 */

/**
 * @typedef {Object} ExtractStrategy
 * @property {string[]} selectors - 优先尝试的 CSS 选择器列表
 * @property {"full_text"|"sections"|"structured"} mode - 提取模式
 * @property {"text"|"array"|"object"} outputShape - 输出格式
 */

/**
 * @typedef {Object} Skill
 * @property {string} name - 唯一标识
 * @property {string} description - 描述
 * @property {function(userQuery: string, snapshot: Object): boolean|{match: boolean, params: Object}} matchIntent - 意图匹配函数
 * @property {WaitStrategy} [waitStrategy] - 导航后的等待策略
 * @property {string[]} [preActions] - 页面预处理动作列表
 * @property {ExtractStrategy} extractStrategy - 内容提取策略
 * @property {function(string): string} [postProcess] - 输出后处理
 * @property {string} [extractionPrompt] - 额外的 LLM 提取提示
 */

export const EXTRACTION_MODES = Object.freeze({
  FULL_TEXT: "full_text",
  SECTIONS: "sections",
  STRUCTURED: "structured"
});

export const OUTPUT_SHAPES = Object.freeze({
  TEXT: "text",
  ARRAY: "array",
  OBJECT: "object"
});

export const WAIT_TYPES = Object.freeze({
  SELECTOR: "selector",
  TIME: "time",
  LOAD: "load"
});

export const PRE_ACTIONS = Object.freeze({
  SCROLL_TO_BOTTOM: "scrollToBottom",
  DISMISS_OVERLAYS: "dismissOverlays",
  WAIT_FOR_LAZY_LOAD: "waitForLazyLoad"
});

/**
 * @typedef {Object} VerificationSkill
 * @property {string} name - 唯一标识
 * @property {string} description - 描述
 * @property {function(snapshot: Object): {blocked: boolean, type: string}} detect - 检测函数
 * @property {function({page: Object, snapshot: Object, timeoutMs: number}): Promise<Object|null>} solve - 解决函数
 */

export const VERIFICATION_TYPES = Object.freeze({
  CLOUDFLARE: "cloudflare",
  CAPTCHA: "captcha",
  REDIRECT: "redirect",
  LOGIN_WALL: "login_wall",
  NONE: "none"
});
