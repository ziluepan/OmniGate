function truncateText(rawText, maxLength) {
  return rawText.length <= maxLength ? rawText : `${rawText.slice(0, maxLength)}…`;
}

function collapseWhitespace(rawText) {
  return rawText.replace(/\s+/gu, " ").trim();
}

function stripMarkdownDecorators(rawText) {
  return rawText
    .replace(/!\[[^\]]*\]\(([^)]+)\)/gu, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1")
    .replace(/^[>#*\-]+\s*/gmu, "")
    .replace(/`{1,3}/gu, "")
    .trim();
}

function extractLineValue(text, label) {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "imu");
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractMarkdownBlock(text) {
  const markerPattern = /^Markdown Content:\s*$/imu;
  const markerMatch = markerPattern.exec(text);

  if (!markerMatch) {
    return "";
  }

  return text.slice(markerMatch.index + markerMatch[0].length).trim();
}

function deriveHeadings(markdown) {
  const markdownHeadings = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^#{1,6}\s+/u.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/u, "").trim())
    .slice(0, 12);

  if (markdownHeadings.length > 0) {
    return markdownHeadings;
  }

  return markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^\d{4}-\d{2}-\d{2}\b/u.test(line) &&
        !/^url source:/iu.test(line) &&
        !/^title:/iu.test(line) &&
        !/^markdown content:/iu.test(line) &&
        !/作者[：:]/u.test(line)
    )
    .map((line) => stripMarkdownDecorators(line))
    .filter((line) => line.length > 0 && line.length <= 120)
    .slice(0, 12);
}

function extractMarkdownLinks(markdown, baseUrl) {
  const discoveredLinks = [];
  const seenLinks = new Set();
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;

  for (const match of markdown.matchAll(linkPattern)) {
    const rawUrl = match[1]?.trim();

    if (!rawUrl) {
      continue;
    }

    try {
      const parsedUrl = new URL(rawUrl, baseUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        continue;
      }

      parsedUrl.hash = "";

      if (seenLinks.has(parsedUrl.href)) {
        continue;
      }

      seenLinks.add(parsedUrl.href);
      discoveredLinks.push(parsedUrl.href);

      if (discoveredLinks.length >= 250) {
        break;
      }
    } catch {
      continue;
    }
  }

  return discoveredLinks;
}

function buildSnapshotFromReadableMirror({ requestedUrl, mirrorUrl, parsed }) {
  const cleanedMarkdown = stripMarkdownDecorators(parsed.markdown);
  const visibleText = collapseWhitespace(cleanedMarkdown);
  const headings = deriveHeadings(parsed.markdown);

  return {
    url: requestedUrl,
    title: parsed.title,
    metaDescription: "",
    headings,
    buttonTexts: [],
    iframeSources: [],
    linkSamples: [],
    discoveredLinks: extractMarkdownLinks(
      parsed.markdown,
      parsed.sourceUrl || requestedUrl
    ),
    sectionCandidates: [
      {
        selector: "markdown-body",
        tagName: "article",
        textSample: truncateText(visibleText, 600)
      }
    ],
    fullVisibleText: cleanedMarkdown,
    visibleText: truncateText(visibleText, 12000),
    rawMarkdown: parsed.markdown,
    mirrorUrl,
    sourceUrl: parsed.sourceUrl
  };
}

export function buildReadableMirrorUrl(
  url,
  baseUrl = "https://r.jina.ai/http://"
) {
  return `${baseUrl}${url.replace(/^https?:\/\//u, "")}`;
}

export function parseReadableMirrorResponse(responseText) {
  return {
    title: extractLineValue(responseText, "Title"),
    sourceUrl: extractLineValue(responseText, "URL Source"),
    markdown: extractMarkdownBlock(responseText)
  };
}

export class ReadableMirrorSnapshotProvider {
  constructor(config = {}, fetchImplementation = globalThis.fetch) {
    if (typeof fetchImplementation !== "function") {
      throw new Error("A fetch implementation is required.");
    }

    this.config = {
      enabled: false,
      baseUrl: "https://r.jina.ai/http://",
      timeoutMs: 15000,
      ...config
    };
    this.fetchImplementation = fetchImplementation;
  }

  async fetch({ url }) {
    if (!this.config.enabled) {
      return null;
    }

    const mirrorUrl = buildReadableMirrorUrl(url, this.config.baseUrl);
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.config.timeoutMs);

    try {
      const response = await this.fetchImplementation(mirrorUrl, {
        headers: {
          accept: "text/plain, text/markdown;q=0.9, */*;q=0.1"
        },
        signal: abortController.signal
      });

      if (!response.ok) {
        return null;
      }

      const responseText = await response.text();
      const parsed = parseReadableMirrorResponse(responseText);

      if (!parsed.title || !parsed.markdown) {
        return null;
      }

      return {
        source: "readable_mirror",
        snapshot: buildSnapshotFromReadableMirror({
          requestedUrl: url,
          mirrorUrl,
          parsed
        }),
        async collectSections() {
          return [];
        }
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
