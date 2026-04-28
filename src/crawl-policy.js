import {
  extractUrlPathname,
  isSameOriginUrl
} from "./url-utils.js";

function escapeRegExp(rawText) {
  return rawText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createWildcardMatcher(pattern) {
  const trimmedPattern = pattern.trim();
  const escapedPattern = escapeRegExp(trimmedPattern).replace(/\\\*/gu, ".*");

  return new RegExp(`^${escapedPattern}$`, "iu");
}

function createPatternMatchers(patterns = []) {
  return patterns
    .filter((pattern) => typeof pattern === "string")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => ({
      pattern,
      matcher: createWildcardMatcher(pattern)
    }));
}

function matchesPattern(url, pathname, matcherEntries) {
  return matcherEntries.some(({ matcher }) => matcher.test(url) || matcher.test(pathname));
}

function selectBudgetRule(rules, url, pathname) {
  const matchingRules = rules.filter(({ pattern, matcher }) => {
    if (pattern === "*") {
      return true;
    }

    if (pattern.startsWith("/")) {
      return pathname.startsWith(pattern) || matcher.test(pathname);
    }

    return matcher.test(url);
  });

  if (matchingRules.length === 0) {
    return null;
  }

  return [...matchingRules].sort(
    (leftRule, rightRule) => rightRule.pattern.length - leftRule.pattern.length
  )[0];
}

export function createCrawlPolicy({
  seedUrl,
  maxDepth = 1,
  sameOriginOnly = true,
  includePatterns = [],
  excludePatterns = []
} = {}) {
  return {
    seedUrl,
    maxDepth,
    sameOriginOnly,
    includePatterns,
    excludePatterns,
    includeMatchers: createPatternMatchers(includePatterns),
    excludeMatchers: createPatternMatchers(excludePatterns)
  };
}

export function evaluateDiscoveredUrl({ candidateUrl, depth, policy }) {
  const pathname = extractUrlPathname(candidateUrl);
  const includeMatchers =
    policy.includeMatchers ?? createPatternMatchers(policy.includePatterns);
  const excludeMatchers =
    policy.excludeMatchers ?? createPatternMatchers(policy.excludePatterns);

  if (depth > policy.maxDepth) {
    return {
      accepted: false,
      reason: "depth"
    };
  }

  if (policy.sameOriginOnly && !isSameOriginUrl(policy.seedUrl, candidateUrl)) {
    return {
      accepted: false,
      reason: "origin"
    };
  }

  if (matchesPattern(candidateUrl, pathname, excludeMatchers)) {
    return {
      accepted: false,
      reason: "exclude"
    };
  }

  if (
    includeMatchers.length > 0 &&
    !matchesPattern(candidateUrl, pathname, includeMatchers)
  ) {
    return {
      accepted: false,
      reason: "include"
    };
  }

  return {
    accepted: true,
    reason: null
  };
}

export class CrawlBudgetTracker {
  constructor(entries = []) {
    this.rules = entries
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.lastIndexOf("=");

        if (separatorIndex <= 0) {
          throw new Error(`Invalid crawl budget entry: ${entry}`);
        }

        const pattern = entry.slice(0, separatorIndex).trim();
        const rawLimit = entry.slice(separatorIndex + 1).trim();
        const limit = Number.parseInt(rawLimit, 10);

        if (!pattern) {
          throw new Error(`Invalid crawl budget entry: ${entry}`);
        }

        if (!Number.isInteger(limit) || limit <= 0) {
          throw new Error(`Crawl budget limit must be a positive integer: ${entry}`);
        }

        return {
          pattern,
          limit,
          matcher: createWildcardMatcher(pattern)
        };
      });
    this.usage = new Map();
  }

  tryConsume(url) {
    if (this.rules.length === 0) {
      return {
        accepted: true,
        rule: null
      };
    }

    const pathname = extractUrlPathname(url);
    const rule = selectBudgetRule(this.rules, url, pathname);

    if (!rule) {
      return {
        accepted: true,
        rule: null
      };
    }

    const currentUsage = this.usage.get(rule.pattern) ?? 0;

    if (currentUsage >= rule.limit) {
      return {
        accepted: false,
        rule: rule.pattern
      };
    }

    this.usage.set(rule.pattern, currentUsage + 1);

    return {
      accepted: true,
      rule: rule.pattern
    };
  }
}
