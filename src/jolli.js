import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const windows = process.platform === "win32";
const command = windows ? process.execPath : "jolli";
const commandArgs = windows ? [path.join(process.env.APPDATA || "", "npm", "node_modules", "@jolli.ai", "cli", "dist", "Cli.js")] : [];

export async function loadCommitMemory(projectRoot, commit, run = runJolli) {
  if (!/^[0-9a-f]{7,64}$/i.test(String(commit || ""))) throw new Error("Invalid commit id");
  const root = path.resolve(projectRoot);
  if (!(await fs.stat(root).catch(() => null))?.isDirectory()) throw new Error(`Invalid project root: ${root}`);
  try {
    const memory = normalizeCommitMemory(JSON.parse(await run(root, commit)));
    return { available: true, memory };
  } catch (error) {
    if (error instanceof SyntaxError) return { available: true, memory: null };
    return { available: false, memory: null };
  }
}

export function normalizeCommitMemory(value) {
  if (!value || typeof value !== "object" || !string(value.commitHash)) return null;
  return {
    commitHash: string(value.commitHash),
    generatedAt: string(value.generatedAt),
    recap: string(value.recap),
    docUrl: /^https:\/\//.test(string(value.jolliDocUrl)) ? string(value.jolliDocUrl) : "",
    topics: Array.isArray(value.topics) ? value.topics.map((topic) => ({
      title: string(topic?.title),
      trigger: string(topic?.trigger),
      response: string(topic?.response),
      decisions: string(topic?.decisions),
      category: string(topic?.category),
      importance: string(topic?.importance),
      filesAffected: Array.isArray(topic?.filesAffected) ? topic.filesAffected.map(string).filter(Boolean) : []
    })).filter((topic) => topic.title) : []
  };
}

async function runJolli(root, commit) {
  const { stdout } = await execFileAsync(command, [...commandArgs, "view", "--commit", commit, "--format", "json", "--cwd", root], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  });
  return stdout;
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}
