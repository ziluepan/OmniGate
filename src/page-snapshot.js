function snapshotEvaluator() {
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
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean)
      .slice(0, limit);
  }

  const candidateElements = Array.from(
    document.querySelectorAll(
      "main, article, section, [role='main'], [role='article'], table, ul, ol, div"
    )
  )
    .filter(isVisible)
    .map((element) => {
      const textContent = (element.textContent ?? "").replace(/\s+/gu, " ").trim();

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
        text: truncate((element.textContent ?? "").replace(/\s+/gu, " ").trim(), 120),
        href: element.href
      })),
    sectionCandidates: candidateElements,
    visibleText: truncate(
      (document.body?.innerText ?? "").replace(/\s+/gu, " ").trim(),
      12000
    )
  };
}

export async function capturePageSnapshot(page) {
  return page.evaluate(snapshotEvaluator);
}

export async function collectSectionsBySelectors(page, selectors) {
  return page.evaluate((rawSelectors) => {
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

    return rawSelectors.flatMap((selector) => {
      try {
        return Array.from(document.querySelectorAll(selector))
          .filter(isVisible)
          .slice(0, 5)
          .map((element) => ({
            selector,
            text: truncate(
              (element.textContent ?? "").replace(/\s+/gu, " ").trim(),
              4000
            )
          }))
          .filter((entry) => entry.text.length > 0);
      } catch {
        return [];
      }
    });
  }, selectors);
}

export async function dismissNuisanceOverlays(page) {
  await page.evaluate(() => {
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
