export function normalizeHttpUrl(rawUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(rawUrl);
  } catch (error) {
    throw new Error("The target URL is invalid.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }

  return parsedUrl.toString();
}

export function resolveDiscoveredUrl(baseUrl, rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl, baseUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    parsedUrl.hash = "";
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export function isSameOriginUrl(leftUrl, rightUrl) {
  return new URL(leftUrl).origin === new URL(rightUrl).origin;
}

export function extractUrlHostname(rawUrl) {
  return new URL(rawUrl).hostname;
}

export function extractUrlPathname(rawUrl) {
  return new URL(rawUrl).pathname;
}
