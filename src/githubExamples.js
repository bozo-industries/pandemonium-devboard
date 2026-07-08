import { readEnvFile, readTextIfExists, parseEnv } from "./env.js";

export const PANDEMONIUM_GITHUB_RAW_BASE = "https://raw.githubusercontent.com/bozo-industries/Pandemonium/master";

const textCache = new Map();

export async function githubText(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized) {
    return "";
  }
  if (textCache.has(normalized)) {
    return textCache.get(normalized);
  }

  const response = await fetch(`${PANDEMONIUM_GITHUB_RAW_BASE}/${encodeRepoPath(normalized)}`, {
    headers: { "cache-control": "no-cache" }
  });
  if (!response.ok) {
    if (response.status === 404) {
      textCache.set(normalized, "");
      return "";
    }
    throw new Error(`GitHub example fetch failed for ${normalized}: HTTP ${response.status}`);
  }

  const text = await response.text();
  textCache.set(normalized, text);
  return text;
}

export async function githubFileExists(relativePath) {
  return (await githubText(relativePath)) !== "";
}

export async function readExampleEnvFile(relativePath, localFallbackPath = "") {
  const text = await githubText(relativePath);
  if (text) {
    return parseEnv(text);
  }
  return localFallbackPath ? readEnvFile(localFallbackPath) : { entries: [], values: {} };
}

export async function readConfigDocs(localFallbackPath) {
  const githubDocs = await githubText("docs/configuration.md");
  const markdown = githubDocs || await readTextIfExists(localFallbackPath);
  return markdown;
}

function normalizeRepoPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function encodeRepoPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}
