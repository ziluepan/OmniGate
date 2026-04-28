import { extractUrlHostname, extractUrlPathname, normalizeHttpUrl } from "./url-utils.js";

const HIGH_VALUE_SEGMENTS = [
  {
    segment: "product",
    bonus: 90
  },
  {
    segment: "products",
    bonus: 90
  },
  {
    segment: "item",
    bonus: 80
  },
  {
    segment: "items",
    bonus: 80
  },
  {
    segment: "article",
    bonus: 60
  },
  {
    segment: "articles",
    bonus: 60
  },
  {
    segment: "post",
    bonus: 50
  },
  {
    segment: "posts",
    bonus: 50
  },
  {
    segment: "guide",
    bonus: 40
  },
  {
    segment: "docs",
    bonus: 40
  }
];

const LOW_VALUE_SEGMENTS = [
  "privacy",
  "terms",
  "cookie",
  "cookies",
  "login",
  "signup",
  "account",
  "checkout",
  "cart",
  "legal"
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function scoreDiscoveredUrl(url, depth) {
  const pathname = extractUrlPathname(url).toLowerCase();
  let score = 1000 - depth * 120;

  for (const { segment, bonus } of HIGH_VALUE_SEGMENTS) {
    if (pathname.includes(segment)) {
      score += bonus;
    }
  }

  for (const segment of LOW_VALUE_SEGMENTS) {
    if (pathname.includes(segment)) {
      score -= 220;
    }
  }

  return clamp(score, 0, 2000);
}

export class UrlFrontier {
  constructor({ roundRobinDomains = false } = {}) {
    this.entries = [];
    this.seenUrls = new Set();
    this.roundRobinDomains = roundRobinDomains;
    this.lastHostname = null;
  }

  has(url) {
    return this.seenUrls.has(normalizeHttpUrl(url));
  }

  push({ url, depth, referrerUrl = null }) {
    const normalizedUrl = normalizeHttpUrl(url);

    if (this.seenUrls.has(normalizedUrl)) {
      return false;
    }

    this.seenUrls.add(normalizedUrl);
    this.entries = [
      ...this.entries,
      {
        url: normalizedUrl,
        depth,
        referrerUrl,
        priority: scoreDiscoveredUrl(normalizedUrl, depth)
      }
    ];

    return true;
  }

  pop() {
    if (this.entries.length === 0) {
      return null;
    }

    const sortedEntries = [...this.entries].sort((leftEntry, rightEntry) => {
      if (rightEntry.priority !== leftEntry.priority) {
        return rightEntry.priority - leftEntry.priority;
      }

      return leftEntry.url.localeCompare(rightEntry.url);
    });
    const preferredIndex = this.roundRobinDomains
      ? sortedEntries.findIndex((entry) => {
          if (!this.lastHostname) {
            return true;
          }

          return extractUrlHostname(entry.url) !== this.lastHostname;
        })
      : 0;
    const selectedEntry =
      sortedEntries[preferredIndex >= 0 ? preferredIndex : 0] ?? null;

    if (!selectedEntry) {
      return null;
    }

    this.entries = this.entries.filter((entry) => entry !== selectedEntry);
    this.lastHostname = extractUrlHostname(selectedEntry.url);

    return selectedEntry;
  }

  size() {
    return this.entries.length;
  }

  isEmpty() {
    return this.entries.length === 0;
  }
}
