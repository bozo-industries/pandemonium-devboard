import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function loadTokenUsage(projectRoot = "") {
  const projectSessionIds = await loadProjectSessionIds(projectRoot);
  const commandArgs = projectSessionIds.size
    ? ["codex", "session", "--json"]
    : ["codex", "daily", "--json"];
  const stdout = await runCcusage(commandArgs);
  const parsed = projectSessionIds.size ? JSON.parse(stdout) : stdout;
  const projectSessions = projectSessionIds.size
    ? (Array.isArray(parsed?.sessions) ? parsed.sessions : []).filter((session) => projectSessionIds.has(sessionKey(session)))
    : [];
  const sessionTitles = projectSessionIds.size ? await loadCodexSessionTitles(projectSessions) : new Map();
  return projectSessionIds.size
    ? parseProjectTokenUsage(parsed, projectSessionIds, projectRoot, sessionTitles)
    : { ...parseTokenUsage(stdout), scope: "global", scopeLabel: "All recorded Codex usage" };
}

async function runCcusage(args) {
  const fullArgs = ["ccusage", ...args];
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npx", ...fullArgs] : fullArgs;
  const { stdout } = await execFileAsync(command, commandArgs, {
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
  });
  return stdout;
}

export function parseTokenUsage(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const totalsSource = parsed?.totals || parsed?.total || parsed?.summary || parsed || {};
  const dailySource = Array.isArray(parsed?.daily) ? parsed.daily
    : Array.isArray(parsed?.data) ? parsed.data
      : Array.isArray(parsed) ? parsed : [];
  return {
    totals: normalizeUsage(totalsSource),
    daily: dailySource.map((entry) => ({
      date: String(entry.date || entry.day || ""),
      models: normalizeModels(entry.models),
      ...normalizeUsage(entry)
    })).filter((entry) => entry.date).reverse()
  };
}

export function parseProjectTokenUsage(raw, projectSessionIds, projectRoot = "", sessionTitles = new Map()) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const matched = sessions.filter((session) => projectSessionIds.has(sessionKey(session)));
  const totals = emptyUsage();
  for (const session of matched) {
    addUsage(totals, normalizeUsage(session));
  }
  return {
    totals,
    daily: matched
      .map((session) => ({
        date: sessionDate(session),
        lastActivity: String(session?.lastActivity || ""),
        sessionId: sessionKey(session),
        label: sessionLabel(session, sessionTitles),
        models: normalizeModels(session.models).sort(),
        ...normalizeUsage(session)
      }))
      .sort((left, right) => right.lastActivity.localeCompare(left.lastActivity)),
    scope: "project",
    scopeLabel: projectRoot ? `Project-scoped usage for ${path.basename(path.resolve(projectRoot))}` : "Project-scoped usage",
    matchedSessions: matched.length,
    availableProjectSessions: projectSessionIds.size
  };
}

export async function loadCodexSessionTitles(
  sessions = [],
  indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl"),
  codexRoot = path.join(os.homedir(), ".codex")
) {
  const text = await fs.readFile(indexPath, "utf8").catch(() => "");
  const titles = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const id = String(entry?.id || "").trim();
      const title = String(entry?.thread_name || "").trim();
      if (id && title) titles.set(id, title);
    } catch {
      // Ignore partially-written index lines.
    }
  }
  for (const session of sessions) {
    const key = sessionKey(session);
    if (!key || titles.has(key)) continue;
    const title = await readCodexSessionPromptTitle(session, codexRoot);
    if (title) titles.set(key, title);
  }
  return titles;
}

function normalizeUsage(source) {
  return {
    inputTokens: pickNumber(source, ["inputTokens", "totalInputTokens", "input"]),
    outputTokens: pickNumber(source, ["outputTokens", "totalOutputTokens", "output"]),
    reasoningTokens: pickNumber(source, ["reasoningOutputTokens", "totalReasoningTokens", "reasoning"]),
    cacheReadTokens: pickNumber(source, ["cacheReadTokens", "totalCacheReadTokens", "cacheRead"]),
    totalTokens: pickNumber(source, ["totalTokens", "tokens"]),
    costUSD: pickNumber(source, ["costUSD", "totalCost", "cost", "totalCostUSD"])
  };
}

async function loadProjectSessionIds(projectRoot) {
  if (!projectRoot) return new Set();
  const attachmentRoot = path.join(path.resolve(projectRoot), ".codex-remote-attachments");
  const entries = await fs.readdir(attachmentRoot, { withFileTypes: true }).catch(() => []);
  return new Set(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.trim())
    .filter(Boolean));
}

function sessionKey(session) {
  const value = String(session?.sessionFile || session?.sessionId || "");
  return value.match(/(019[0-9a-f-]{32,})$/i)?.[1] ?? value;
}

function sessionDate(session) {
  const value = String(session?.lastActivity || session?.date || "");
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "unknown";
}

function sessionLabel(session, sessionTitles) {
  const key = sessionKey(session);
  return sessionTitles.get(key) || `Session ${key.slice(0, 8) || sessionDate(session)}`;
}

async function readCodexSessionPromptTitle(session, codexRoot) {
  for (const filePath of sessionFileCandidates(session, codexRoot)) {
    const title = await readFirstUserPromptTitle(filePath);
    if (title) return title;
  }
  return "";
}

function sessionFileCandidates(session, codexRoot) {
  const sessionFile = String(session?.sessionFile || "").trim();
  const sessionId = String(session?.sessionId || "").trim();
  const candidates = [];
  if (sessionId.includes("/")) {
    candidates.push(path.join(codexRoot, "sessions", ...sessionId.split("/")) + ".jsonl");
  }
  if (sessionFile) {
    candidates.push(path.join(codexRoot, "archived_sessions", `${sessionFile}.jsonl`));
  }
  return [...new Set(candidates)];
}

async function readFirstUserPromptTitle(filePath) {
  if (!await fileExists(filePath)) return "";
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let inspected = 0;
  try {
    for await (const line of lines) {
      inspected += 1;
      if (inspected > 600) break;
      const title = titleFromSessionLine(line);
      if (title) return title;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return "";
}

function titleFromSessionLine(line) {
  try {
    const entry = JSON.parse(line);
    if (entry?.type !== "response_item" || entry?.payload?.type !== "message" || entry.payload.role !== "user") {
      return "";
    }
    return userPromptTitle(entry.payload.content);
  } catch {
    return "";
  }
}

function userPromptTitle(content) {
  const parts = Array.isArray(content) ? content : [];
  for (const part of parts) {
    if (part?.type !== "input_text" || typeof part.text !== "string") continue;
    const title = cleanPromptTitle(part.text);
    if (title) return title;
  }
  return "";
}

function cleanPromptTitle(text) {
  let value = text.replace(/\r?\n/gu, " ").replace(/\s+/gu, " ").trim();
  if (!value || shouldSkipPromptTitle(value)) return "";
  const requestIndex = value.toLowerCase().lastIndexOf("my request for codex:");
  if (requestIndex >= 0) value = value.slice(requestIndex + "my request for codex:".length).trim();
  value = value
    .replace(/<image\b[^>]*>.*?<\/image>/giu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/^#+\s*/u, "")
    .trim();
  if (!value || shouldSkipPromptTitle(value)) return "";
  return value.length > 42 ? `${value.slice(0, 39).trim()}...` : value;
}

function shouldSkipPromptTitle(value) {
  return /^<(?:recommended_plugins|environment_context|permissions instructions|collaboration_mode)\b/iu.test(value)
    || /^AGENTS\.md instructions\b/iu.test(value)
    || /^#\s*global agent instructions\b/iu.test(value)
    || /^files mentioned by the user:/iu.test(value);
}

async function fileExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costUSD: 0
  };
}

function addUsage(target, source) {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningTokens += source.reasoningTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.totalTokens += source.totalTokens;
  target.costUSD += source.costUSD;
}

function pickNumber(source, names) {
  for (const name of names) {
    if (source?.[name] !== undefined && source[name] !== null) {
      const number = Number(source[name]);
      return Number.isFinite(number) ? number : 0;
    }
  }
  return 0;
}

function normalizeModels(models) {
  if (Array.isArray(models)) return models.map(String);
  if (typeof models === "string" && models) return [models];
  if (models && typeof models === "object") return Object.keys(models);
  return [];
}
