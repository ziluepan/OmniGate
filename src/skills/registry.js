/**
 * SkillRegistry — 技能注册表
 *
 * 管理 content skills 和 verification skills 的注册与匹配。
 * 使用 URL 特征 + LLM 意图分析来选择合适的 skill。
 */

export class SkillRegistry {
  constructor() {
    /** @type {import("./types.js").Skill[]} */
    this.skills = [];
    /** @type {import("./types.js").VerificationSkill[]} */
    this.verificationSkills = [];
  }

  /**
   * 注册一个内容抓取 skill
   * @param {import("./types.js").Skill} skill
   */
  register(skill) {
    if (!skill.name) {
      throw new Error("Skill must have a name");
    }

    if (this.skills.some((existing) => existing.name === skill.name)) {
      return;
    }

    this.skills = [...this.skills, skill];
  }

  /**
   * 注册一个验证处理 skill
   * @param {import("./types.js").VerificationSkill} verificationSkill
   */
  registerVerification(verificationSkill) {
    if (!verificationSkill.name) {
      throw new Error("Verification skill must have a name");
    }

    if (
      this.verificationSkills.some(
        (existing) => existing.name === verificationSkill.name
      )
    ) {
      return;
    }

    this.verificationSkills = [...this.verificationSkills, verificationSkill];
  }

  /**
   * 根据用户意图和页面快照匹配合适的 skill
   *
   * @param {Object} params
   * @param {string} params.userQuery - 用户查询
   * @param {Object} params.snapshot - 页面快照
   * @param {{ skill?: string, confidence?: number }} [params.llmIntent] - LLM 意图分析结果
   * @returns {{ skill: import("./types.js").Skill, params: Object }}
   */
  matchIntent({ userQuery, snapshot, llmIntent }) {
    const url = snapshot?.url ?? "";
    const title = snapshot?.title ?? "";

    // 如果 LLM 已经分析了意图，先尝试精确匹配 skill 名称
    if (llmIntent?.skill) {
      const exactMatch = this.skills.find(
        (s) => s.name === llmIntent.skill
      );

      if (exactMatch) {
        return { skill: exactMatch, params: llmIntent.params ?? {} };
      }
    }

    // 否则按顺序尝试每个 skill 的 matchIntent
    for (const skill of this.skills) {
      if (typeof skill.matchIntent === "function") {
        const matchResult = skill.matchIntent(userQuery, snapshot);

        if (typeof matchResult === "object" && matchResult.match) {
          return { skill, params: matchResult.params ?? {} };
        }

        if (matchResult === true) {
          return { skill, params: {} };
        }
      }
    }

    // Fallback: 返回 generic-page skill
    const generic = this.skills.find((s) => s.name === "generic-page");

    return { skill: generic ?? null, params: {} };
  }

  /**
   * 检测并分类页面验证类型
   *
   * @param {Object} snapshot - 页面快照
   * @returns {{ blocked: boolean, type: string, handler: import("./types.js").VerificationSkill|null }}
   */
  detectVerification(snapshot) {
    for (const handler of this.verificationSkills) {
      if (typeof handler.detect === "function") {
        const result = handler.detect(snapshot);

        if (result?.blocked) {
          return {
            blocked: true,
            type: result.type ?? handler.name,
            handler
          };
        }
      }
    }

    return { blocked: false, type: "none", handler: null };
  }

  /**
   * 获取所有已注册的 content skills
   * @returns {import("./types.js").Skill[]}
   */
  getAllSkills() {
    return [...this.skills];
  }

  /**
   * 根据名称查找 skill
   * @param {string} name
   * @returns {import("./types.js").Skill|undefined}
   */
  getSkill(name) {
    return this.skills.find((s) => s.name === name);
  }

  /**
   * 获取 skill 的描述列表（用于 LLM intent 分析）
   * @returns {Array<{name: string, description: string}>}
   */
  getSkillDescriptions() {
    return this.skills.map((s) => ({
      name: s.name,
      description: s.description
    }));
  }
}
