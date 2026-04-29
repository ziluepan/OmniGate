async function safeEvaluate(page, fn, ...args) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (args.length === 0) {
        return await page.evaluate(fn);
      }

      if (args.length === 1) {
        return await page.evaluate(fn, args[0]);
      }

      throw new Error(
        "safeEvaluate only supports zero or one serializable argument."
      );
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        /execution context was destroyed/i.test(error.message)
      ) {
        // Wait for the page to settle after a navigation
        await page.waitForLoadState("networkidle", {
          timeout: 5000
        }).catch(() => {});
        await page.waitForTimeout(1000 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

function snapshotEvaluator() {
  function truncate(rawText, maxLength) {
    return rawText.length <= maxLength
      ? rawText
      : `${rawText.slice(0, maxLength)}…`;
  }

  function compactText(rawText) {
    return rawText.replace(/\s+/gu, " ").trim();
  }

  function normalizeStructuredText(rawText) {
    return rawText
      .replace(/\r/gu, "")
      .replace(/\u00a0/gu, " ")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/gu, ""))
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  }

  function removeCodeGutters(root) {
    root.querySelectorAll(
      ".gutter, .line-numbers, .line-numbers-rows, .hljs-ln-numbers, .rouge-gutter, td.gutter, pre.line-numbers"
    ).forEach((element) => {
      element.remove();
    });
  }

  function extractElementText(element, { preserveFormatting = false } = {}) {
    const workingElement = element.cloneNode(true);
    removeCodeGutters(workingElement);

    if (preserveFormatting) {
      return normalizeStructuredText(
        workingElement.innerText ?? workingElement.textContent ?? ""
      );
    }

    return compactText(workingElement.textContent ?? "");
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function uniqueSelector(element) {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    let currentElement = element;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
      let selector = currentElement.tagName.toLowerCase();

      if (currentElement.classList.length > 0) {
        selector += `.${CSS.escape(currentElement.classList[0])}`;
      }

      const parentElement = currentElement.parentElement;

      if (parentElement) {
        const sameTagSiblings = Array.from(parentElement.children).filter(
          (child) => child.tagName === currentElement.tagName
        );

        if (sameTagSiblings.length > 1) {
          const siblingIndex = sameTagSiblings.indexOf(currentElement) + 1;
          selector += `:nth-of-type(${siblingIndex})`;
        }
      }

      parts.unshift(selector);

      if (
        currentElement.tagName.toLowerCase() === "body" ||
        currentElement.tagName.toLowerCase() === "html"
      ) {
        break;
      }

      currentElement = currentElement.parentElement;
    }

    return parts.join(" > ");
  }

  function textList(selector, limit = 20) {
    return Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .map((element) => compactText(element.textContent ?? ""))
      .filter(Boolean)
      .slice(0, limit);
  }

  function collectDiscoveredLinks(limit = 250) {
    const seenLinks = new Set();
    const discoveredLinks = [];

    for (const anchor of document.querySelectorAll("a[href]")) {
      const rawHref = anchor.getAttribute("href");

      if (!rawHref) {
        continue;
      }

      try {
        const parsedUrl = new URL(rawHref, window.location.href);

        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          continue;
        }

        parsedUrl.hash = "";

        if (seenLinks.has(parsedUrl.href)) {
          continue;
        }

        seenLinks.add(parsedUrl.href);
        discoveredLinks.push(parsedUrl.href);

        if (discoveredLinks.length >= limit) {
          break;
        }
      } catch {
        continue;
      }
    }

    return discoveredLinks;
  }

  const candidateElements = Array.from(
    document.querySelectorAll(
      "main, article, section, [role='main'], [role='article'], table, ul, ol, div"
    )
  )
    .filter(isVisible)
    .map((element) => {
      const textContent = extractElementText(element);

      return {
        element,
        textContent
      };
    })
    .filter(({ textContent }) => textContent.length >= 80)
    .slice(0, 25)
    .map(({ element, textContent }) => ({
      selector: uniqueSelector(element),
      tagName: element.tagName.toLowerCase(),
      textSample: truncate(textContent, 600)
    }));

  return {
    url: window.location.href,
    title: document.title,
    metaDescription:
      document.querySelector("meta[name='description']")?.getAttribute("content") ??
      "",
    fullVisibleText: (document.body?.innerText ?? "").trim(),
    headings: textList("h1, h2, h3", 12),
    buttonTexts: textList("button, [role='button'], input[type='submit']", 16),
    iframeSources: Array.from(document.querySelectorAll("iframe"))
      .map((element) => element.getAttribute("src") ?? "")
      .filter(Boolean)
      .slice(0, 10),
    linkSamples: Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisible)
      .slice(0, 20)
      .map((element) => ({
        text: truncate(compactText(element.textContent ?? ""), 120),
        href: element.href
      })),
    discoveredLinks: collectDiscoveredLinks(),
    sectionCandidates: candidateElements,
    visibleText: truncate(compactText(document.body?.innerText ?? ""), 12000)
  };
}

export async function capturePageSnapshot(page) {
  return safeEvaluate(page, snapshotEvaluator);
}

export async function collectSectionsBySelectors(page, selectors, options = {}) {
  return safeEvaluate(page, ({ selectors: rawSelectors, options: rawOptions }) => {
    function truncate(rawText, maxLength) {
      return rawText.length <= maxLength
        ? rawText
        : `${rawText.slice(0, maxLength)}…`;
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const maxMatches =
      Number.isInteger(rawOptions?.maxMatches) && rawOptions.maxMatches > 0
        ? rawOptions.maxMatches
        : 5;
    const maxTextLength =
      Number.isInteger(rawOptions?.maxTextLength) && rawOptions.maxTextLength > 0
        ? rawOptions.maxTextLength
        : 4000;
    const mergeMatches = rawOptions?.mergeMatches === true;
    const preserveFormatting = rawOptions?.preserveFormatting === true;

    function compactText(rawText) {
      return rawText.replace(/\s+/gu, " ").trim();
    }

    function normalizeStructuredText(rawText) {
      return rawText
        .replace(/\r/gu, "")
        .replace(/\u00a0/gu, " ")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/gu, ""))
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
    }

    function removeCodeGutters(root) {
      root.querySelectorAll(
        ".gutter, .line-numbers, .line-numbers-rows, .hljs-ln-numbers, .rouge-gutter, td.gutter, pre.line-numbers"
      ).forEach((element) => {
        element.remove();
      });
    }

    function extractElementText(element) {
      const workingElement = element.cloneNode(true);
      removeCodeGutters(workingElement);

      if (preserveFormatting) {
        return normalizeStructuredText(
          workingElement.innerText ?? workingElement.textContent ?? ""
        );
      }

      return compactText(workingElement.textContent ?? "");
    }

    return rawSelectors.flatMap((selector) => {
      try {
        const matchedTexts = Array.from(document.querySelectorAll(selector))
          .filter(isVisible)
          .slice(0, maxMatches)
          .map((element) => extractElementText(element))
          .filter((text) => text.length > 0);

        if (matchedTexts.length === 0) {
          return [];
        }

        if (mergeMatches) {
          return [
            {
              selector,
              text: truncate(matchedTexts.join("\n\n"), maxTextLength)
            }
          ];
        }

        return matchedTexts.map((text) => ({
          selector,
          text: truncate(text, maxTextLength)
        }));
      } catch {
        return [];
      }
    });
  }, {
    selectors,
    options
  });
}

export async function dismissNuisanceOverlays(page) {
  await safeEvaluate(page, () => {
    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const overlayKeywords = [
      "cookie",
      "privacy",
      "consent",
      "gdpr",
      "隐私",
      "cookie 政策",
      "同意"
    ];
    const actionKeywords = [
      "accept",
      "agree",
      "allow all",
      "got it",
      "同意",
      "接受",
      "知道了"
    ];

    const buttons = Array.from(
      document.querySelectorAll("button, [role='button'], input[type='button']")
    ).filter(isVisible);

    for (const button of buttons) {
      const buttonText = (
        button.textContent ??
        button.getAttribute("value") ??
        ""
      )
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();

      if (!buttonText) {
        continue;
      }

      const containerText = (
        button.closest("[role='dialog'], dialog, form, div, section, aside")?.textContent ??
        ""
      )
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();

      const isConsentButton = actionKeywords.some((keyword) =>
        buttonText.includes(keyword)
      );
      const isConsentOverlay = overlayKeywords.some((keyword) =>
        containerText.includes(keyword)
      );

      if (isConsentButton && isConsentOverlay) {
        button.click();
      }
    }
  });
}
