function truncateText(rawText, maxLength) {
  return rawText.length <= maxLength ? rawText : `${rawText.slice(0, maxLength)}…`;
}

function collapseWhitespace(rawText) {
  return rawText.replace(/\s+/gu, " ").trim();
}

function decodeHtmlEntities(rawText) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return rawText.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/giu,
    (fullMatch, entity) => {
      const normalizedEntity = entity.toLowerCase();

      if (normalizedEntity in namedEntities) {
        return namedEntities[normalizedEntity];
      }

      if (normalizedEntity.startsWith("#x")) {
        const parsedCodePoint = Number.parseInt(normalizedEntity.slice(2), 16);
        return Number.isNaN(parsedCodePoint)
          ? fullMatch
          : String.fromCodePoint(parsedCodePoint);
      }

      if (normalizedEntity.startsWith("#")) {
        const parsedCodePoint = Number.parseInt(normalizedEntity.slice(1), 10);
        return Number.isNaN(parsedCodePoint)
          ? fullMatch
          : String.fromCodePoint(parsedCodePoint);
      }

      return fullMatch;
    }
  );
}

function parseHtmlAttributes(rawAttributeText) {
  const attributes = {};
  const attributePattern =
    /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

  for (const match of rawAttributeText.matchAll(attributePattern)) {
    const attributeName = match[1]?.toLowerCase();

    if (!attributeName) {
      continue;
    }

    attributes[attributeName] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? ""
    );
  }

  return attributes;
}

function stripHtmlToText(rawHtml) {
  return decodeHtmlEntities(
    rawHtml
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(
        /<(script|style|noscript|template|svg|canvas)[^>]*>[\s\S]*?<\/\1>/giu,
        " "
      )
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(
        /<\/(address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/giu,
        "\n"
      )
      .replace(/<[^>]+>/gu, " ")
  );
}

function normalizeFullText(rawText) {
  return rawText
    .replace(/\r/gu, "")
    .split(/\n+/u)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractTitle(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);

  if (titleMatch?.[1]) {
    return collapseWhitespace(decodeHtmlEntities(stripHtmlToText(titleMatch[1])));
  }

  for (const metaTagMatch of html.matchAll(/<meta\b([^>]+)>/giu)) {
    const attributes = parseHtmlAttributes(metaTagMatch[1]);
    const propertyValue = attributes.property?.toLowerCase();

    if (propertyValue === "og:title" || propertyValue === "twitter:title") {
      return collapseWhitespace(attributes.content ?? "");
    }
  }

  return "";
}

function extractMetaDescription(html) {
  for (const metaTagMatch of html.matchAll(/<meta\b([^>]+)>/giu)) {
    const attributes = parseHtmlAttributes(metaTagMatch[1]);
    const nameValue = attributes.name?.toLowerCase();
    const propertyValue = attributes.property?.toLowerCase();

    if (
      nameValue === "description" ||
      propertyValue === "og:description" ||
      propertyValue === "twitter:description"
    ) {
      return collapseWhitespace(attributes.content ?? "");
    }
  }

  return "";
}

function extractHeadings(html, limit = 12) {
  const headings = [];

  for (const headingMatch of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/giu)) {
    const text = collapseWhitespace(stripHtmlToText(headingMatch[1] ?? ""));

    if (!text) {
      continue;
    }

    headings.push(text);

    if (headings.length >= limit) {
      break;
    }
  }

  return headings;
}

function extractSectionText(html, tagName) {
  const sectionPattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "iu"
  );
  const sectionMatch = html.match(sectionPattern);

  if (!sectionMatch?.[1]) {
    return "";
  }

  return normalizeFullText(stripHtmlToText(sectionMatch[1]));
}

function extractLinks(html, baseUrl) {
  const discoveredLinks = [];
  const linkSamples = [];
  const seenLinks = new Set();

  for (const anchorMatch of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const attributes = parseHtmlAttributes(anchorMatch[1] ?? "");
    const rawHref = attributes.href?.trim();

    if (!rawHref) {
      continue;
    }

    try {
      const parsedUrl = new URL(rawHref, baseUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        continue;
      }

      parsedUrl.hash = "";

      if (!seenLinks.has(parsedUrl.href)) {
        seenLinks.add(parsedUrl.href);
        discoveredLinks.push(parsedUrl.href);
      }

      if (linkSamples.length < 20) {
        const linkText = collapseWhitespace(
          stripHtmlToText(anchorMatch[2] ?? "")
        );

        linkSamples.push({
          text: truncateText(linkText, 120),
          href: parsedUrl.href
        });
      }

      if (discoveredLinks.length >= 250) {
        break;
      }
    } catch {
      continue;
    }
  }

  return {
    discoveredLinks,
    linkSamples
  };
}

function buildSectionCandidates(fullVisibleText, articleText, mainText) {
  const sectionCandidates = [];

  if (articleText.length >= 80) {
    sectionCandidates.push({
      selector: "article",
      tagName: "article",
      textSample: truncateText(articleText, 600)
    });
  }

  if (mainText.length >= 80) {
    sectionCandidates.push({
      selector: "main",
      tagName: "main",
      textSample: truncateText(mainText, 600)
    });
  }

  if (fullVisibleText.length >= 80) {
    sectionCandidates.push({
      selector: "body",
      tagName: "body",
      textSample: truncateText(fullVisibleText, 600)
    });
  }

  return sectionCandidates;
}

function buildSnapshotFromHtml({ requestedUrl, responseUrl, html }) {
  const fullVisibleText = normalizeFullText(stripHtmlToText(html));
  const articleText = extractSectionText(html, "article");
  const mainText = extractSectionText(html, "main");
  const { discoveredLinks, linkSamples } = extractLinks(html, responseUrl);

  return {
    url: responseUrl,
    sourceUrl: requestedUrl,
    title: extractTitle(html),
    metaDescription: extractMetaDescription(html),
    headings: extractHeadings(html),
    buttonTexts: [],
    iframeSources: [],
    linkSamples,
    discoveredLinks,
    sectionCandidates: buildSectionCandidates(
      fullVisibleText,
      articleText,
      mainText
    ),
    fullVisibleText,
    visibleText: truncateText(collapseWhitespace(fullVisibleText), 12000)
  };
}

export class DirectHttpSnapshotProvider {
  constructor(config = {}, fetchImplementation = globalThis.fetch) {
    if (typeof fetchImplementation !== "function") {
      throw new Error("A fetch implementation is required.");
    }

    this.config = {
      enabled: true,
      timeoutMs: 15000,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      ...config
    };
    this.fetchImplementation = fetchImplementation;
  }

  async fetch({ url }) {
    if (!this.config.enabled) {
      return null;
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.config.timeoutMs);

    try {
      const response = await this.fetchImplementation(url, {
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
          "user-agent": this.config.userAgent
        },
        redirect: "follow",
        signal: abortController.signal
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (!/text\/html|application\/xhtml\+xml/iu.test(contentType)) {
        return null;
      }

      const html = await response.text();
      const snapshot = buildSnapshotFromHtml({
        requestedUrl: url,
        responseUrl: response.url || url,
        html
      });
      const selectorTextMap = new Map([
        ["article", extractSectionText(html, "article")],
        ["main", extractSectionText(html, "main")],
        ["body", snapshot.fullVisibleText]
      ]);

      if (!snapshot.fullVisibleText) {
        return null;
      }

      return {
        source: "http_fetch",
        snapshot,
        async collectSections(selectors = []) {
          return selectors
            .map((selector) => {
              const text = selectorTextMap.get(selector);

              return text
                ? {
                    selector,
                    text
                  }
                : null;
            })
            .filter(Boolean);
        }
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export class CompositeSnapshotProvider {
  constructor(providers = []) {
    this.providers = providers.filter(Boolean);
  }

  async fetch(context) {
    for (const provider of this.providers) {
      if (typeof provider?.fetch !== "function") {
        continue;
      }

      try {
        const result = await provider.fetch(context);

        if (result?.snapshot) {
          return result;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
