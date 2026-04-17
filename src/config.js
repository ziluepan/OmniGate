import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function stripWrappingQuotes(rawValue) {
  if (rawValue.length < 2) {
    return rawValue;
  }

  const firstCharacter = rawValue[0];
  const lastCharacter = rawValue[rawValue.length - 1];

  if (
    (firstCharacter === `"` && lastCharacter === `"`) ||
    (firstCharacter === `'` && lastCharacter === `'`)
  ) {
    return rawValue.slice(1, -1);
  }

  return rawValue;
}

export function parseEnvText(envText) {
  const parsedEntries = {};
  const lines = envText.split(/\r?\n/u);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    parsedEntries[key] = stripWrappingQuotes(rawValue);
  }

  return parsedEntries;
}

export function loadEnvFile(cwd = process.cwd()) {
  const envFilePath = join(cwd, ".env");

  if (!existsSync(envFilePath)) {
    return {};
  }

  return parseEnvText(readFileSync(envFilePath, "utf8"));
}

function readPositiveInteger(rawValue, fallbackValue, variableName) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsedValue;
}

function readBooleanFlag(rawValue, fallbackValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  const normalizedValue = String(rawValue).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw new Error("Boolean configuration values must be true/false, yes/no, on/off, or 1/0.");
}

export function loadCrawlerConfig({
  cwd = process.cwd(),
  env = process.env
} = {}) {
  const fileEnv = loadEnvFile(cwd);
  const mergedEnv = {
    ...fileEnv,
    ...env
  };
  const requiredVariables = ["AI_API_URL", "AI_MODEL", "AI_API_KEY"];
  const missingVariables = requiredVariables.filter(
    (variableName) => !mergedEnv[variableName]
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(", ")}`
    );
  }

  const storageStateFilePath = resolve(
    cwd,
    mergedEnv.CRAWLER_STORAGE_STATE_PATH ?? ".crawler-auth.json"
  );

  return {
    aiApiUrl: mergedEnv.AI_API_URL,
    aiModel: mergedEnv.AI_MODEL,
    aiApiKey: mergedEnv.AI_API_KEY,
    aiTimeoutMs: readPositiveInteger(
      mergedEnv.AI_TIMEOUT_MS,
      600000,
      "AI_TIMEOUT_MS"
    ),
    navigationTimeoutMs: readPositiveInteger(
      mergedEnv.CRAWLER_NAVIGATION_TIMEOUT_MS,
      30000,
      "CRAWLER_NAVIGATION_TIMEOUT_MS"
    ),
    manualAuthTimeoutMs: readPositiveInteger(
      mergedEnv.CRAWLER_MANUAL_AUTH_TIMEOUT_MS,
      120000,
      "CRAWLER_MANUAL_AUTH_TIMEOUT_MS"
    ),
    readableMirrorEnabled: readBooleanFlag(
      mergedEnv.CRAWLER_ENABLE_READABLE_MIRROR_FALLBACK,
      false
    ),
    readableMirrorBaseUrl:
      mergedEnv.CRAWLER_READABLE_MIRROR_BASE_URL?.trim() ||
      "https://r.jina.ai/http://",
    readableMirrorTimeoutMs: readPositiveInteger(
      mergedEnv.CRAWLER_READABLE_MIRROR_TIMEOUT_MS,
      15000,
      "CRAWLER_READABLE_MIRROR_TIMEOUT_MS"
    ),
    storageStatePath: storageStateFilePath,
    browserExecutablePath:
      mergedEnv.CRAWLER_BROWSER_EXECUTABLE_PATH?.trim() || undefined
  };
}
