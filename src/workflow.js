import { UrlFrontier } from "./crawl-frontier.js";
import {
  createCrawlPolicy,
  CrawlBudgetTracker,
  evaluateDiscoveredUrl
} from "./crawl-policy.js";
import { detectVerificationSignals } from "./verification.js";
import { resolveDiscoveredUrl } from "./url-utils.js";
import { analyzeUserIntent } from "./intent-analyzer.js";

function normalizeExtractionPlan(rawPlan) {
  const targetSectionSelectors = Array.isArray(rawPlan?.targetSectionSelectors)
    ? rawPlan.targetSectionSelectors
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    targetSectionSelectors,
    extractionMode:
      rawPlan?.extractionMode === "sections" ? "sections" : "full_text",
    outputShape:
      rawPlan?.outputShape === "array" || rawPlan?.outputShape === "text"
        ? rawPlan.outputShape
        : "object",
    reason: typeof rawPlan?.reason === "string" ? rawPlan.reason : ""
  };
}

async function closeSession(session) {
  if (typeof session?.close !== "function") {
    return;
  }

  await session.close();
}

function resolveDirectContent(snapshot) {
  if (typeof snapshot?.rawMarkdown === "string" && snapshot.rawMarkdown.length > 0) {
    return {
      content: snapshot.rawMarkdown,
      format: "markdown"
    };
  }

  if (
    typeof snapshot?.fullVisibleText === "string" &&
    snapshot.fullVisibleText.length > 0
  ) {
    return {
      content: snapshot.fullVisibleText,
      format: "text"
    };
  }

  return {
    content: snapshot?.visibleText ?? "",
    format: "text"
  };
}

/**
 * Select the best skill for this page based on user intent.
 *
 * Layer 1 of the three-layer decision system:
 *   LLM analyzes user intent → selects matching skill.
 *
 * Falls back to rule-based matching if LLM analysis fails.
 * Returns null if no registry is provided (legacy mode).
 */
async function selectPageSkill({ registry, aiClient, url, userQuery }) {
  if (!registry) {
    return null;
  }

  try {
    const snapshot = { url };
    const skillDescriptions = registry.getSkillDescriptions();
    const intent = await analyzeUserIntent({
      userQuery,
      snapshot,
      skillDescriptions,
      aiClient
    });
    const match = registry.matchIntent({
      userQuery,
      snapshot,
      llmIntent: intent
    });

    return match.skill ?? null;
  } catch (firstError) {
    // If LLM matching fails, try rule-based matching
    try {
      const snapshot = { url };
      const match = registry.matchIntent({ userQuery, snapshot });
      return match.skill ?? null;
    } catch {
      console.warn(
        `[aicrawler] Skill matching failed for ${url}: both LLM and rule-based matching failed`
      );
      return null;
    }
  }
}

/**
 * Resolve verification challenges using session capabilities and fallback provider.
 *
 * Handles the three-tier verification flow:
 *   1. Auto-solve (Cloudflare Turnstile click-through)
 *   2. Manual verification (wait for human to solve)
 *   3. Fallback snapshot provider (readable mirror)
 *
 * Uses registry for richer verification type classification when available.
 *
 * @returns {{ snapshot: Object, activeSource: string, collectSections: Function|null, blocked: boolean }}
 */
async function resolveVerification({
  snapshot,
  session,
  fallbackSnapshotProvider,
  url,
  userQuery,
  resolvedOptions,
  activeSource,
  collectSections,
  registry
}) {
  // Classification: use registry verification skills if available, otherwise legacy
  let verification = detectVerificationSignals(snapshot);

  if (registry && !verification.blocked) {
    const registryDetection = registry.detectVerification(snapshot);

    if (registryDetection.blocked) {
      verification = {
        blocked: true,
        signals: [registryDetection.type],
        reason: `Detected ${registryDetection.type} verification`
      };
    }
  }

  // Tier 1: auto-solve (Cloudflare Turnstile)
  if (
    verification.blocked &&
    typeof session.autoSolveChallenge === "function"
  ) {
    const unlockedSnapshot = await session.autoSolveChallenge({
      timeoutMs: 20000
    });

    if (unlockedSnapshot) {
      snapshot = unlockedSnapshot;
      verification = detectVerificationSignals(snapshot);
    }
  }

  // Tier 2: manual verification
  if (
    verification.blocked &&
    resolvedOptions.allowManualVerification &&
    typeof session.waitForManualVerification === "function"
  ) {
    const unlockedSnapshot = await session.waitForManualVerification({
      timeoutMs: resolvedOptions.manualAuthTimeoutMs,
      currentSnapshot: snapshot
    });

    if (unlockedSnapshot) {
      snapshot = unlockedSnapshot;
      verification = detectVerificationSignals(snapshot);
    }
  }

  // Tier 3: fallback snapshot provider
  if (verification.blocked && fallbackSnapshotProvider) {
    const fallbackContext = await fallbackSnapshotProvider.fetch({
      url,
      blockedSnapshot: snapshot,
      userQuery
    });

    if (fallbackContext?.snapshot) {
      snapshot = fallbackContext.snapshot;
      activeSource =
        typeof fallbackContext.source === "string"
          ? fallbackContext.source
          : "fallback";
      collectSections =
        typeof fallbackContext.collectSections === "function"
          ? fallbackContext.collectSections.bind(fallbackContext)
          : null;
      verification = detectVerificationSignals(snapshot);
    }
  }

  return {
    snapshot,
    activeSource,
    collectSections,
    blocked: verification.blocked,
    verification
  };
}

/**
 * Run the AI extraction pipeline: analyze structure → collect sections → extract content.
 *
 * Uses skill hints (extractStrategy, extractionPrompt) when a skill is selected.
 */
async function runExtractionPipeline({
  aiClient,
  snapshot,
  url,
  userQuery,
  collectSections,
  selectedSkill
}) {
  const plan = normalizeExtractionPlan(
    await aiClient.analyzeStructure({
      url: snapshot?.url ?? url,
      userQuery,
      snapshot,
      skillExtractStrategy: selectedSkill?.extractStrategy
    })
  );
  const sections =
    plan.targetSectionSelectors.length > 0 &&
    typeof collectSections === "function"
      ? await collectSections(plan.targetSectionSelectors)
      : [];
  const extractionResult = await aiClient.extractContent({
    url: snapshot?.url ?? url,
    userQuery,
    snapshot,
    plan,
    sections,
    extractionPrompt: selectedSkill?.extractionPrompt
  });

  return { plan, extractionResult };
}

async function processPageWithSession({
  session,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  registry
}) {
  const resolvedOptions = {
    allowManualVerification: false,
    persistStorageState: false,
    manualAuthTimeoutMs: 120000,
    returnFullContent: false,
    ...options
  };

  // Layer 1: Intent analysis → skill selection
  const selectedSkill = await selectPageSkill({
    registry,
    aiClient,
    url,
    userQuery
  });

  await session.navigate(url);

  // Layer 2: Skill-driven preActions or legacy dismiss
  if (
    selectedSkill &&
    Array.isArray(selectedSkill.preActions) &&
    selectedSkill.preActions.length > 0 &&
    typeof session.executePreActions === "function"
  ) {
    await session.executePreActions(selectedSkill.preActions);
  } else if (typeof session.dismissNuisanceOverlays === "function") {
    await session.dismissNuisanceOverlays();
  }

  let snapshot = await session.captureSnapshot();
  let activeSource = "browser";
  let collectSections =
    typeof session.collectSections === "function"
      ? session.collectSections.bind(session)
      : null;

  // Layer 3: Verification resolution
  const resolution = await resolveVerification({
    snapshot,
    session,
    fallbackSnapshotProvider,
    url,
    userQuery,
    resolvedOptions,
    activeSource,
    collectSections,
    registry
  });

  if (resolution.blocked) {
    return {
      snapshot: resolution.snapshot,
      result: {
        status: "blocked",
        url: resolution.snapshot?.url ?? url,
        title: resolution.snapshot?.title ?? "",
        reason: resolution.verification.reason,
        signals: resolution.verification.signals
      }
    };
  }

  snapshot = resolution.snapshot;
  activeSource = resolution.activeSource;
  collectSections = resolution.collectSections;

  // Direct content mode: return without AI
  if (resolvedOptions.returnFullContent) {
    const directContent = resolveDirectContent(snapshot);

    if (
      resolvedOptions.persistStorageState &&
      typeof session.saveStorageState === "function"
    ) {
      await session.saveStorageState();
    }

    return {
      snapshot,
      result: {
        status: "ok",
        url: snapshot?.url ?? url,
        title: snapshot?.title ?? "",
        contentSource: activeSource,
        contentFormat: directContent.format,
        contentLength: directContent.content.length,
        data: directContent.content,
        confidence: null
      }
    };
  }

  // AI extraction pipeline with skill hints
  const { plan, extractionResult } = await runExtractionPipeline({
    aiClient,
    snapshot,
    url,
    userQuery,
    collectSections,
    selectedSkill
  });

  if (
    resolvedOptions.persistStorageState &&
    typeof session.saveStorageState === "function"
  ) {
    await session.saveStorageState();
  }

  return {
    snapshot,
    result: {
      status: "ok",
      url: snapshot?.url ?? url,
      title: snapshot?.title ?? "",
      contentSource: activeSource,
      plan,
      data: extractionResult?.answer ?? null,
      confidence:
        typeof extractionResult?.confidence === "number"
          ? extractionResult.confidence
          : null
    }
  };
}

function createFrontierStats() {
  return {
    enqueued: 0,
    skippedDuplicate: 0,
    skippedFiltered: 0,
    skippedBudget: 0
  };
}

function enqueueDiscoveredLinks({
  snapshot,
  currentEntry,
  frontier,
  policy,
  budgetTracker,
  frontierStats
}) {
  const rawDiscoveredLinks = Array.isArray(snapshot?.discoveredLinks)
    ? snapshot.discoveredLinks
    : [];
  let enqueuedCount = 0;

  for (const rawLink of rawDiscoveredLinks) {
    const candidateUrl = resolveDiscoveredUrl(currentEntry.url, rawLink);

    if (!candidateUrl) {
      frontierStats.skippedFiltered += 1;
      continue;
    }

    if (frontier.has(candidateUrl)) {
      frontierStats.skippedDuplicate += 1;
      continue;
    }

    const evaluation = evaluateDiscoveredUrl({
      candidateUrl,
      depth: currentEntry.depth + 1,
      policy
    });

    if (!evaluation.accepted) {
      frontierStats.skippedFiltered += 1;
      continue;
    }

    const budgetDecision = budgetTracker.tryConsume(candidateUrl);

    if (!budgetDecision.accepted) {
      frontierStats.skippedBudget += 1;
      continue;
    }

    const inserted = frontier.push({
      url: candidateUrl,
      depth: currentEntry.depth + 1,
      referrerUrl: currentEntry.url
    });

    if (inserted) {
      enqueuedCount += 1;
      frontierStats.enqueued += 1;
    } else {
      frontierStats.skippedDuplicate += 1;
    }
  }

  return {
    discoveredCount: rawDiscoveredLinks.length,
    enqueuedCount
  };
}

function averageConfidence(pages) {
  const confidenceValues = pages
    .map((page) => page.confidence)
    .filter((value) => typeof value === "number");

  if (confidenceValues.length === 0) {
    return null;
  }

  const total = confidenceValues.reduce((sum, value) => sum + value, 0);
  return total / confidenceValues.length;
}

export async function runCrawlerWorkflow({
  session,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  registry
}) {
  try {
    const { result } = await processPageWithSession({
      session,
      fallbackSnapshotProvider,
      aiClient,
      url,
      userQuery,
      options,
      registry
    });

    return result;
  } finally {
    await closeSession(session);
  }
}

export async function runSiteCrawlerWorkflow({
  session,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  crawlOptions = {},
  registry
}) {
  const resolvedCrawlOptions = {
    maxPages:
      Number.isInteger(crawlOptions.maxPages) && crawlOptions.maxPages > 0
        ? crawlOptions.maxPages
        : 10,
    maxDepth:
      Number.isInteger(crawlOptions.maxDepth) && crawlOptions.maxDepth >= 0
        ? crawlOptions.maxDepth
        : 1,
    sameOriginOnly: crawlOptions.sameOriginOnly ?? true,
    includePatterns: crawlOptions.includePatterns ?? [],
    excludePatterns: crawlOptions.excludePatterns ?? [],
    budgetEntries: crawlOptions.budgetEntries ?? [],
    roundRobinDomains: crawlOptions.roundRobinDomains ?? false
  };
  const policy = createCrawlPolicy({
    seedUrl: url,
    maxDepth: resolvedCrawlOptions.maxDepth,
    sameOriginOnly: resolvedCrawlOptions.sameOriginOnly,
    includePatterns: resolvedCrawlOptions.includePatterns,
    excludePatterns: resolvedCrawlOptions.excludePatterns
  });
  const budgetTracker = new CrawlBudgetTracker(
    resolvedCrawlOptions.budgetEntries
  );
  const frontier = new UrlFrontier({
    roundRobinDomains: resolvedCrawlOptions.roundRobinDomains
  });
  const frontierStats = createFrontierStats();
  const pages = [];

  frontier.push({
    url,
    depth: 0,
    referrerUrl: null
  });

  try {
    while (
      !frontier.isEmpty() &&
      pages.length < resolvedCrawlOptions.maxPages
    ) {
      const currentEntry = frontier.pop();

      if (!currentEntry) {
        break;
      }

      try {
        const { snapshot, result } = await processPageWithSession({
          session,
          fallbackSnapshotProvider,
          aiClient,
          url: currentEntry.url,
          userQuery,
          options,
          registry
        });
        const enqueueOutcome =
          result.status === "ok"
            ? enqueueDiscoveredLinks({
                snapshot,
                currentEntry,
                frontier,
                policy,
                budgetTracker,
                frontierStats
              })
            : {
                discoveredCount: Array.isArray(snapshot?.discoveredLinks)
                  ? snapshot.discoveredLinks.length
                  : 0,
                enqueuedCount: 0
              };

        pages.push({
          ...result,
          depth: currentEntry.depth,
          referrerUrl: currentEntry.referrerUrl,
          discoveredCount: enqueueOutcome.discoveredCount,
          enqueuedCount: enqueueOutcome.enqueuedCount
        });
      } catch (error) {
        pages.push({
          status: "error",
          url: currentEntry.url,
          title: "",
          depth: currentEntry.depth,
          referrerUrl: currentEntry.referrerUrl,
          error: error instanceof Error ? error.message : String(error),
          data: null,
          confidence: null,
          discoveredCount: 0,
          enqueuedCount: 0
        });
      }
    }

    const successfulPages = pages.filter((page) => page.status === "ok");
    const blockedPages = pages.filter((page) => page.status === "blocked");
    let synthesizedResult = null;

    if (
      !options.returnFullContent &&
      successfulPages.length > 0 &&
      typeof aiClient?.synthesizeCrawlResults === "function"
    ) {
      synthesizedResult = await aiClient.synthesizeCrawlResults({
        startUrl: url,
        userQuery,
        pages: successfulPages
      });
    }

    return {
      status:
        successfulPages.length > 0
          ? "ok"
          : blockedPages.length > 0
            ? "blocked"
            : "error",
      mode: "crawl",
      url,
      title: successfulPages[0]?.title ?? pages[0]?.title ?? "",
      contentSource: "crawl",
      pages,
      pageCount: pages.length,
      frontierStats,
      data:
        synthesizedResult?.answer ??
        successfulPages.map((page) => page.data),
      confidence:
        typeof synthesizedResult?.confidence === "number"
          ? synthesizedResult.confidence
          : averageConfidence(successfulPages)
    };
  } finally {
    await closeSession(session);
  }
}
