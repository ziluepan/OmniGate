import { UrlFrontier } from "./crawl-frontier.js";
import {
  createCrawlPolicy,
  CrawlBudgetTracker,
  evaluateDiscoveredUrl
} from "./crawl-policy.js";
import {
  decideTaskTool,
  TASK_TOOL_NAMES
} from "./task-router.js";
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

function createSessionRuntime({ session = null, getSession = null } = {}) {
  return {
    session,
    getSession:
      typeof getSession === "function" ? getSession : null
  };
}

async function ensureSession(sessionRuntime) {
  if (sessionRuntime?.session) {
    return sessionRuntime.session;
  }

  if (typeof sessionRuntime?.getSession !== "function") {
    return null;
  }

  const createdSession = await sessionRuntime.getSession();
  sessionRuntime.session = createdSession ?? null;
  return sessionRuntime.session;
}

async function closeSession(sessionOrRuntime) {
  const session =
    sessionOrRuntime &&
    typeof sessionOrRuntime === "object" &&
    "session" in sessionOrRuntime
      ? sessionOrRuntime.session
      : sessionOrRuntime;

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

function detectVerification(snapshot, registry) {
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

  return verification;
}

function buildSectionCollectionOptions(plan) {
  const isTextOutput = plan?.outputShape === "text";

  return {
    maxMatches: isTextOutput ? 40 : 5,
    maxTextLength: isTextOutput ? 120000 : 12000,
    mergeMatches: isTextOutput,
    preserveFormatting: isTextOutput
  };
}

async function collectPlanSections({ collectSections, plan }) {
  if (
    typeof collectSections !== "function" ||
    !Array.isArray(plan?.targetSectionSelectors) ||
    plan.targetSectionSelectors.length === 0
  ) {
    return [];
  }

  return collectSections(
    plan.targetSectionSelectors,
    buildSectionCollectionOptions(plan)
  );
}

function getSnapshotTextLength(snapshot) {
  if (typeof snapshot?.fullVisibleText === "string") {
    return snapshot.fullVisibleText.trim().length;
  }

  if (typeof snapshot?.visibleText === "string") {
    return snapshot.visibleText.trim().length;
  }

  return 0;
}

function hasUsefulFocusedSections(sections, plan) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return false;
  }

  if (plan?.outputShape === "text") {
    const combinedLength = sections.reduce(
      (sum, section) =>
        sum +
        (typeof section?.text === "string" ? section.text.trim().length : 0),
      0
    );

    return combinedLength >= 500;
  }

  return sections.some(
    (section) =>
      typeof section?.text === "string" && section.text.trim().length >= 20
  );
}

function shouldUseFallbackPageContext(
  pageContext,
  {
    canCreateBrowserSession = false
  } = {}
) {
  const { snapshot, activeSource, resolvedOptions } = pageContext;
  const textLength = getSnapshotTextLength(snapshot);
  const hasSectionCandidates =
    Array.isArray(snapshot?.sectionCandidates) &&
    snapshot.sectionCandidates.length > 0;

  if (!snapshot) {
    return false;
  }

  if (pageContext.blocked) {
    return !canCreateBrowserSession;
  }

  if (resolvedOptions.returnFullContent) {
    return textLength > 0;
  }

  if (activeSource === "readable_mirror") {
    return !canCreateBrowserSession;
  }

  if (activeSource === "http_fetch") {
    return textLength > 0 || hasSectionCandidates;
  }

  return textLength > 0 || hasSectionCandidates;
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

  let ruleMatchedSkill = null;

  try {
    const match = registry.matchIntent({
      userQuery,
      snapshot: { url }
    });

    ruleMatchedSkill = match.skill ?? null;

    if (ruleMatchedSkill?.name && ruleMatchedSkill.name !== "generic-page") {
      return ruleMatchedSkill;
    }
  } catch {
    ruleMatchedSkill = null;
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

    return match.skill ?? ruleMatchedSkill ?? null;
  } catch {
    if (ruleMatchedSkill) {
      return ruleMatchedSkill;
    }

    console.warn(
      `[aicrawler] Skill matching failed for ${url}: both LLM and rule-based matching failed`
    );
    return null;
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
  let verification = detectVerification(snapshot, registry);

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
      verification = detectVerification(snapshot, registry);
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
      verification = detectVerification(snapshot, registry);
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
      verification = detectVerification(snapshot, registry);
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
 * Run the first half of the AI extraction pipeline: analyze structure → collect sections.
 *
 * Uses skill hints (extractStrategy) when a skill is selected.
 */
async function runStructurePipeline({
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
  const sections = await collectPlanSections({
    collectSections,
    plan
  });

  return { plan, sections };
}

async function runContentExtraction({
  aiClient,
  snapshot,
  url,
  userQuery,
  plan,
  sections,
  selectedSkill
}) {
  return aiClient.extractContent({
    url: snapshot?.url ?? url,
    userQuery,
    snapshot,
    plan,
    sections,
    extractionPrompt: selectedSkill?.extractionPrompt
  });
}

function createBrowserUnavailableError(url) {
  return new Error(
    `Browser session is unavailable for ${url}; falling back to snapshot providers.`
  );
}

async function resolvePageContextFromFallback({
  snapshotProvider,
  url,
  userQuery,
  resolvedOptions,
  selectedSkill,
  browserError,
  registry
}) {
  if (typeof snapshotProvider?.fetch !== "function") {
    throw browserError ??
      new Error(`Unable to capture ${url}: no browser session or fallback provider available.`);
  }

  const fallbackContext = await snapshotProvider.fetch({
    url,
    blockedSnapshot: null,
    userQuery,
    browserError
  });

  if (!fallbackContext?.snapshot) {
    throw browserError ??
      new Error(`Unable to capture ${url}: fallback snapshot provider returned no content.`);
  }

  const verification = detectVerification(
    fallbackContext.snapshot,
    registry
  );

  return {
    resolvedOptions,
    selectedSkill,
    snapshot: fallbackContext.snapshot,
    activeSource:
      typeof fallbackContext.source === "string"
        ? fallbackContext.source
        : "fallback",
    collectSections:
      typeof fallbackContext.collectSections === "function"
        ? fallbackContext.collectSections.bind(fallbackContext)
        : null,
    blocked: verification.blocked,
    verification
  };
}

async function resolvePageContextWithSession({
  sessionRuntime,
  fallbackSnapshotProvider,
  url,
  userQuery,
  resolvedOptions,
  selectedSkill,
  registry
}) {
  let session = null;

  try {
    session = await ensureSession(sessionRuntime);
  } catch (browserError) {
    return resolvePageContextFromFallback({
      snapshotProvider: fallbackSnapshotProvider,
      url,
      userQuery,
      resolvedOptions,
      selectedSkill,
      browserError,
      registry
    });
  }

  if (!session) {
    return resolvePageContextFromFallback({
      snapshotProvider: fallbackSnapshotProvider,
      url,
      userQuery,
      resolvedOptions,
      selectedSkill,
      browserError: createBrowserUnavailableError(url),
      registry
    });
  }

  try {
    await session.navigate(url);

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

    snapshot = resolution.snapshot;
    activeSource = resolution.activeSource;
    collectSections = resolution.collectSections;

    return {
      resolvedOptions,
      selectedSkill,
      snapshot,
      activeSource,
      collectSections,
      blocked: resolution.blocked,
      verification: resolution.verification
    };
  } catch (browserError) {
    return resolvePageContextFromFallback({
      snapshotProvider: fallbackSnapshotProvider,
      url,
      userQuery,
      resolvedOptions,
      selectedSkill,
      browserError,
      registry
    });
  }
}

async function resolvePageContext({
  sessionRuntime,
  initialSnapshotProvider,
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
    skipSkillSelection: false,
    ...options
  };

  const selectedSkill =
    resolvedOptions.returnFullContent || resolvedOptions.skipSkillSelection
      ? null
      : await selectPageSkill({
          registry,
          aiClient,
          url,
          userQuery
        });

  const canCreateBrowserSession =
    Boolean(sessionRuntime?.session) ||
    typeof sessionRuntime?.getSession === "function";
  const primarySnapshotProvider =
    initialSnapshotProvider ?? fallbackSnapshotProvider;

  let fallbackPageContext = null;

  const shouldAttemptFallbackFirst =
    !sessionRuntime?.session && primarySnapshotProvider;

  if (shouldAttemptFallbackFirst) {
    try {
      fallbackPageContext = await resolvePageContextFromFallback({
        snapshotProvider: primarySnapshotProvider,
        url,
        userQuery,
        resolvedOptions,
        selectedSkill,
        browserError: canCreateBrowserSession
          ? null
          : createBrowserUnavailableError(url),
        registry
      });

      if (
        shouldUseFallbackPageContext(fallbackPageContext, {
          canCreateBrowserSession
        })
      ) {
        return fallbackPageContext;
      }

      if (!canCreateBrowserSession) {
        return fallbackPageContext;
      }
    } catch {
      fallbackPageContext = null;
    }
  }

  if (canCreateBrowserSession) {
    try {
      return await resolvePageContextWithSession({
        sessionRuntime,
        fallbackSnapshotProvider,
        resolvedOptions,
        selectedSkill,
        url,
        userQuery,
        registry
      });
    } catch (browserError) {
      if (fallbackPageContext) {
        return fallbackPageContext;
      }

      throw browserError;
    }
  }

  if (fallbackPageContext) {
    return fallbackPageContext;
  }

  return resolvePageContextWithSession({
    sessionRuntime,
    fallbackSnapshotProvider,
    resolvedOptions,
    selectedSkill,
    url,
    userQuery,
    registry
  });
}

async function processPageWithSession({
  sessionRuntime,
  initialSnapshotProvider,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  registry
}) {
  const pageContext = await resolvePageContext({
    sessionRuntime,
    initialSnapshotProvider,
    fallbackSnapshotProvider,
    registry,
    aiClient,
    url,
    userQuery,
    options
  });
  const {
    resolvedOptions,
    selectedSkill,
    snapshot,
    activeSource,
    collectSections,
    blocked,
    verification
  } = pageContext;

  if (blocked) {
    return {
      snapshot,
      result: {
        status: "blocked",
        url: snapshot?.url ?? url,
        title: snapshot?.title ?? "",
        reason: verification.reason,
        signals: verification.signals
      }
    };
  }

  // Direct content mode: return without AI
  if (resolvedOptions.returnFullContent) {
    const directContent = resolveDirectContent(snapshot);

    if (
      resolvedOptions.persistStorageState &&
      typeof sessionRuntime?.session?.saveStorageState === "function"
    ) {
      await sessionRuntime.session.saveStorageState();
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
        confidence: null,
        mode: TASK_TOOL_NAMES.FULL_CONTENT,
        tool: TASK_TOOL_NAMES.FULL_CONTENT
      }
    };
  }

  let currentPageContext = pageContext;
  let currentSnapshot = snapshot;
  let currentActiveSource = activeSource;
  let currentCollectSections = collectSections;

  let { plan, sections } = await runStructurePipeline({
    aiClient,
    snapshot: currentSnapshot,
    url,
    userQuery,
    collectSections: currentCollectSections,
    selectedSkill
  });

  if (
    currentActiveSource === "http_fetch" &&
    typeof sessionRuntime?.getSession === "function" &&
    (
      plan.extractionMode !== "sections" ||
      !hasUsefulFocusedSections(sections, plan)
    )
  ) {
    currentPageContext = await resolvePageContextWithSession({
      sessionRuntime,
      fallbackSnapshotProvider,
      resolvedOptions,
      selectedSkill,
      url,
      userQuery,
      registry
    });

    if (currentPageContext.blocked) {
      return {
        snapshot: currentPageContext.snapshot,
        result: {
          status: "blocked",
          url: currentPageContext.snapshot?.url ?? url,
          title: currentPageContext.snapshot?.title ?? "",
          reason: currentPageContext.verification.reason,
          signals: currentPageContext.verification.signals
        }
      };
    }

    currentSnapshot = currentPageContext.snapshot;
    currentActiveSource = currentPageContext.activeSource;
    currentCollectSections = currentPageContext.collectSections;

    ({ plan, sections } = await runStructurePipeline({
      aiClient,
      snapshot: currentSnapshot,
      url,
      userQuery,
      collectSections: currentCollectSections,
      selectedSkill
    }));
  }

  const extractionResult = await runContentExtraction({
    aiClient,
    snapshot: currentSnapshot,
    url,
    userQuery,
    plan,
    sections,
    selectedSkill
  });

  if (
    resolvedOptions.persistStorageState &&
    typeof sessionRuntime?.session?.saveStorageState === "function"
  ) {
    await sessionRuntime.session.saveStorageState();
  }

  return {
    snapshot: currentSnapshot,
    result: {
      status: "ok",
      url: currentSnapshot?.url ?? url,
      title: currentSnapshot?.title ?? "",
      contentSource: currentActiveSource,
      plan,
      data: extractionResult?.answer ?? null,
      confidence:
        typeof extractionResult?.confidence === "number"
          ? extractionResult.confidence
          : null,
      mode: TASK_TOOL_NAMES.EXTRACT,
      tool: TASK_TOOL_NAMES.EXTRACT
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
  getSession,
  initialSnapshotProvider,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  registry
}) {
  const sessionRuntime = createSessionRuntime({
    session,
    getSession
  });

  try {
    const { result } = await processPageWithSession({
      sessionRuntime,
      initialSnapshotProvider,
      fallbackSnapshotProvider,
      aiClient,
      url,
      userQuery,
      options,
      registry
    });

    return result;
  } finally {
    await closeSession(sessionRuntime);
  }
}

export async function runLinksWorkflow({
  session,
  getSession,
  initialSnapshotProvider,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  registry
}) {
  const sessionRuntime = createSessionRuntime({
    session,
    getSession
  });

  try {
    const pageContext = await resolvePageContext({
      sessionRuntime,
      initialSnapshotProvider,
      fallbackSnapshotProvider,
      aiClient,
      url,
      userQuery,
      options: {
        ...options,
        skipSkillSelection: true
      },
      registry
    });

    if (pageContext.blocked) {
      return {
        status: "blocked",
        url: pageContext.snapshot?.url ?? url,
        title: pageContext.snapshot?.title ?? "",
        reason: pageContext.verification.reason,
        signals: pageContext.verification.signals,
        mode: TASK_TOOL_NAMES.LINKS,
        tool: TASK_TOOL_NAMES.LINKS
      };
    }

    const links = Array.isArray(pageContext.snapshot?.discoveredLinks)
      ? pageContext.snapshot.discoveredLinks
      : [];

    return {
      status: "ok",
      url: pageContext.snapshot?.url ?? url,
      title: pageContext.snapshot?.title ?? "",
      contentSource: pageContext.activeSource,
      data: {
        links,
        count: links.length
      },
      confidence: null,
      mode: TASK_TOOL_NAMES.LINKS,
      tool: TASK_TOOL_NAMES.LINKS
    };
  } finally {
    await closeSession(sessionRuntime);
  }
}

export async function runSiteCrawlerWorkflow({
  session,
  getSession,
  initialSnapshotProvider,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {},
  crawlOptions = {},
  registry
}) {
  const sessionRuntime = createSessionRuntime({
    session,
    getSession
  });
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
          sessionRuntime,
          initialSnapshotProvider,
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
      tool: TASK_TOOL_NAMES.CRAWL,
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
    await closeSession(sessionRuntime);
  }
}

export async function runTaskWorkflow({
  session,
  getSession,
  initialSnapshotProvider,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  explicitTool,
  crawl = false,
  options = {},
  crawlOptions = {},
  registry
}) {
  const toolDecision = decideTaskTool({
    userQuery,
    explicitTool,
    crawl,
    fullContent: options.returnFullContent
  });

  if (toolDecision.tool === TASK_TOOL_NAMES.CRAWL) {
    return {
      ...(await runSiteCrawlerWorkflow({
        session,
        getSession,
        initialSnapshotProvider,
        fallbackSnapshotProvider,
        aiClient,
        url,
        userQuery,
        options,
        crawlOptions,
        registry
      })),
      toolDecision
    };
  }

  if (toolDecision.tool === TASK_TOOL_NAMES.LINKS) {
    return {
      ...(await runLinksWorkflow({
        session,
        getSession,
        initialSnapshotProvider,
        fallbackSnapshotProvider,
        aiClient,
        url,
        userQuery,
        options,
        registry
      })),
      toolDecision
    };
  }

  if (toolDecision.tool === TASK_TOOL_NAMES.FULL_CONTENT) {
    return {
      ...(await runCrawlerWorkflow({
        session,
        getSession,
        initialSnapshotProvider,
        fallbackSnapshotProvider,
        aiClient,
        url,
        userQuery,
        options: {
          ...options,
          returnFullContent: true
        },
        registry
      })),
      mode: TASK_TOOL_NAMES.FULL_CONTENT,
      tool: TASK_TOOL_NAMES.FULL_CONTENT,
      toolDecision
    };
  }

  return {
    ...(await runCrawlerWorkflow({
      session,
      getSession,
      initialSnapshotProvider,
      fallbackSnapshotProvider,
      aiClient,
      url,
      userQuery,
      options: {
        ...options,
        returnFullContent: false
      },
      registry
    })),
    mode: TASK_TOOL_NAMES.EXTRACT,
    tool: TASK_TOOL_NAMES.EXTRACT,
    toolDecision
  };
}
