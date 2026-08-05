import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function loadTokenUsage(projectRoot = "") {
  const projectSessionIds = await loadProjectSessionIds(projectRoot);
  const commandArgs = projectSessionIds.size
    ? ["codex", "session", "--json"]
    : ["codex", "daily", "--json"];
  const stdout = await runCcusage(commandArgs);
  return projectSessionIds.size
    ? parseProjectTokenUsage(stdout, projectSessionIds, projectRoot)
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

export function parseProjectTokenUsage(raw, projectSessionIds, projectRoot = "") {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const matched = sessions.filter((session) => projectSessionIds.has(sessionKey(session)));
  const dailyByDate = new Map();
  const totals = emptyUsage();
  for (const session of matched) {
    addUsage(totals, normalizeUsage(session));
    const date = sessionDate(session);
    const daily = dailyByDate.get(date) ?? { date, models: new Set(), ...emptyUsage() };
    addUsage(daily, normalizeUsage(session));
    for (const model of normalizeModels(session.models)) daily.models.add(model);
    dailyByDate.set(date, daily);
  }
  return {
    totals,
    daily: [...dailyByDate.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((entry) => ({ ...entry, models: [...entry.models].sort() })),
    scope: "project",
    scopeLabel: projectRoot ? `Project-scoped usage for ${path.basename(path.resolve(projectRoot))}` : "Project-scoped usage",
    matchedSessions: matched.length,
    availableProjectSessions: projectSessionIds.size
  };
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
