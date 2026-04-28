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
    const genericSkill =
      this.skills.find((skill) => skill.name === "generic-page") ?? null;
    const llmMatchedSkill = llmIntent?.skill
      ? this.skills.find((skill) => skill.name === llmIntent.skill) ?? null
      : null;

    if (llmMatchedSkill && llmMatchedSkill.name !== "generic-page") {
      return { skill: llmMatchedSkill, params: llmIntent.params ?? {} };
    }

    const matchedSkills = [];

    for (const skill of this.skills) {
      if (skill.name === "generic-page") {
        continue;
      }

      if (typeof skill.matchIntent === "function") {
        const matchResult = skill.matchIntent(userQuery, snapshot);

        if (typeof matchResult === "object" && matchResult.match) {
          matchedSkills.push({
            skill,
            params: matchResult.params ?? {}
          });
        }

        if (matchResult === true) {
          matchedSkills.push({
            skill,
            params: {}
          });
        }
      }
    }

    if (matchedSkills.length > 0) {
      const prioritizedMatch = [...matchedSkills].sort((leftMatch, rightMatch) => {
        const leftPriority = leftMatch.skill.priority ?? 0;
        const rightPriority = rightMatch.skill.priority ?? 0;

        return rightPriority - leftPriority;
      })[0];

      return prioritizedMatch;
    }

    if (llmMatchedSkill) {
      return { skill: llmMatchedSkill, params: llmIntent.params ?? {} };
    }

    return { skill: genericSkill, params: {} };
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
