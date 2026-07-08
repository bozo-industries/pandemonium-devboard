import fs from "node:fs/promises";
import path from "node:path";

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const hadTrailingNewline = /\r?\n$/.test(text);
  const entries = [];
  const values = {};
  let pendingComments = [];

  lines.forEach((raw, index) => {
    if (index === lines.length - 1 && raw === "" && hadTrailingNewline) {
      return;
    }

    const trimmed = raw.trim();
    if (trimmed === "") {
      entries.push({ type: "blank", raw });
      pendingComments = [];
      return;
    }

    if (trimmed.startsWith("#")) {
      entries.push({ type: "comment", raw });
      pendingComments.push(trimmed.replace(/^#\s?/, ""));
      return;
    }

    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) {
      entries.push({ type: "raw", raw });
      pendingComments = [];
      return;
    }

    const key = match[1];
    const parsed = unquoteValue(match[2].trim());
    const entry = {
      type: "pair",
      raw,
      key,
      value: parsed.value,
      quote: parsed.quote,
      comments: pendingComments
    };
    entries.push(entry);
    values[key] = parsed.value;
    pendingComments = [];
  });

  return { entries, values, hadTrailingNewline };
}

export function envKeys(parsed) {
  return parsed.entries
    .filter((entry) => entry.type === "pair")
    .map((entry) => entry.key);
}

export async function readEnvFile(filePath) {
  const text = await readTextIfExists(filePath);
  return parseEnv(text);
}

export async function writeEnvFile(filePath, values) {
  validateValues(values);
  const existingText = await readTextIfExists(filePath);
  const parsed = parseEnv(existingText);
  const used = new Set();
  const nextLines = [];

  for (const entry of parsed.entries) {
    if (entry.type !== "pair") {
      nextLines.push(entry.raw);
      continue;
    }

    if (Object.hasOwn(values, entry.key)) {
      nextLines.push(formatPair(entry.key, values[entry.key], entry.quote));
      used.add(entry.key);
    } else {
      nextLines.push(entry.raw);
    }
  }

  const missing = Object.keys(values).filter((key) => !used.has(key));
  if (missing.length > 0 && nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
    nextLines.push("");
  }
  for (const key of missing) {
    nextLines.push(formatPair(key, values[key]));
  }

  const nextText = `${nextLines.join("\n")}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, nextText, "utf8");
}

export function buildRows(exampleParsed, actualParsed) {
  const orderedKeys = [];
  for (const key of envKeys(exampleParsed)) {
    if (!orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }
  }
  for (const key of envKeys(actualParsed)) {
    if (!orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }
  }

  const exampleEntries = entriesByKey(exampleParsed);
  const actualEntries = entriesByKey(actualParsed);
  return orderedKeys.map((key) => {
    const exampleEntry = exampleEntries.get(key);
    const actualEntry = actualEntries.get(key);
    const exampleValue = exampleParsed.values[key] ?? "";
    const actualValue = actualParsed.values[key] ?? "";
    const hasActual = actualEntry !== undefined;
    const hasExample = exampleEntry !== undefined;
    return {
      key,
      exampleValue,
      actualValue,
      effectiveValue: hasActual ? actualValue : exampleValue,
      hasActual,
      hasExample,
      status: hasActual ? (actualValue === "" ? "empty" : "set") : "missing",
      comments: [...(exampleEntry?.comments ?? []), ...(actualEntry?.comments ?? [])].filter(Boolean)
    };
  });
}

function entriesByKey(parsed) {
  const map = new Map();
  for (const entry of parsed.entries) {
    if (entry.type === "pair") {
      map.set(entry.key, entry);
    }
  }
  return map;
}

function validateValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("values must be an object");
  }
  for (const [key, value] of Object.entries(values)) {
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`invalid env key: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`value for ${key} must be a string`);
    }
  }
}

function unquoteValue(value) {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return { value: value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\""), quote: "\"" };
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return { value: value.slice(1, -1), quote: "'" };
  }
  return { value, quote: "" };
}

function formatPair(key, value, quote = "") {
  if (quote === "\"") {
    return `${key}="${value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, "\\\"")}"`;
  }
  if (quote === "'") {
    return `${key}='${value.replace(/'/g, "'\\''")}'`;
  }
  if (needsQuotes(value)) {
    return `${key}="${value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, "\\\"")}"`;
  }
  return `${key}=${value}`;
}

function needsQuotes(value) {
  return /\s|["#]/.test(value);
}
