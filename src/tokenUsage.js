import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function loadTokenUsage() {
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec || "cmd.exe") : "npx";
  const args = windows
    ? ["/d", "/s", "/c", "npx ccusage codex daily --json"]
    : ["ccusage", "codex", "daily", "--json"];
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
  });
  return parseTokenUsage(stdout);
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
    })).filter((entry) => entry.date).slice(-30).reverse()
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
  return [];
}
