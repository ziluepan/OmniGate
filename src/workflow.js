import { detectVerificationSignals } from "./verification.js";

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

export async function runCrawlerWorkflow({
  session,
  fallbackSnapshotProvider,
  aiClient,
  url,
  userQuery,
  options = {}
}) {
  const resolvedOptions = {
    allowManualVerification: false,
    persistStorageState: false,
    manualAuthTimeoutMs: 120000,
    returnFullContent: false,
    ...options
  };

  try {
    await session.navigate(url);

    if (typeof session.dismissNuisanceOverlays === "function") {
      await session.dismissNuisanceOverlays();
    }

    let snapshot = await session.captureSnapshot();
    let activeSource = "browser";
    let collectSections =
      typeof session.collectSections === "function"
        ? session.collectSections.bind(session)
        : null;
    let verification = detectVerificationSignals(snapshot);

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

    if (verification.blocked) {
      return {
        status: "blocked",
        url: snapshot?.url ?? url,
        title: snapshot?.title ?? "",
        reason: verification.reason,
        signals: verification.signals
      };
    }

    if (resolvedOptions.returnFullContent) {
      const directContent = resolveDirectContent(snapshot);

      if (
        resolvedOptions.persistStorageState &&
        typeof session.saveStorageState === "function"
      ) {
        await session.saveStorageState();
      }

      return {
        status: "ok",
        url: snapshot?.url ?? url,
        title: snapshot?.title ?? "",
        contentSource: activeSource,
        contentFormat: directContent.format,
        contentLength: directContent.content.length,
        data: directContent.content,
        confidence: null
      };
    }

    const plan = normalizeExtractionPlan(
      await aiClient.analyzeStructure({
        url,
        userQuery,
        snapshot
      })
    );
    const sections =
      plan.targetSectionSelectors.length > 0 && typeof collectSections === "function"
        ? await collectSections(plan.targetSectionSelectors)
        : [];
    const extractionResult = await aiClient.extractContent({
      url: snapshot?.url ?? url,
      userQuery,
      snapshot,
      plan,
      sections
    });

    if (
      resolvedOptions.persistStorageState &&
      typeof session.saveStorageState === "function"
    ) {
      await session.saveStorageState();
    }

    return {
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
    };
  } finally {
    await closeSession(session);
  }
}
