import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FIELD = "\u001f";
const RECORD = "\u001e";
const MAX_BUFFER = 4 * 1024 * 1024;

export async function recentCommits(projectRoot, requestedLimit = 20) {
  const root = await gitRoot(projectRoot);
  const limit = Math.max(1, Math.min(100, Number(requestedLimit) || 20));
  const format = "%x1e" + ["%H", "%h", "%aI", "%an", "%ae", "%s", "%P"].join("%x1f");
  const stdout = await runGit(root, ["log", `-${limit}`, "--numstat", `--format=${format}`]);
  return {
    root,
    branch: (await runGit(root, ["branch", "--show-current"])).trim() || "detached HEAD",
    commits: parseCommitLogWithStats(stdout)
  };
}

export async function commitDetails(projectRoot, commit) {
  assertCommit(commit);
  const root = await gitRoot(projectRoot);
  const format = ["%H", "%h", "%aI", "%an", "%ae", "%s", "%b", "%P"].join("%x1f") + "%x1e";
  const metadata = parseCommitLog(await runGit(root, ["show", "-s", `--format=${format}`, commit]))[0];
  if (!metadata) throw new Error("Commit not found");
  const files = parseChangedFiles(await runGit(root, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", commit]));
  return { root, ...metadata, files };
}

export async function commitFileDiff(projectRoot, commit, filePath) {
  assertCommit(commit);
  const root = await gitRoot(projectRoot);
  const normalizedPath = safeRelativePath(filePath);
  const patch = await runGit(root, ["show", "--format=", "--no-ext-diff", "--find-renames", "--unified=40", commit, "--", normalizedPath]);
  return { root, commit, path: normalizedPath, patch, truncated: false };
}

export function parseCommitLog(stdout) {
  return stdout.split(RECORD).map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, shortHash, date, author, email, subject, bodyOrParents = "", maybeParents] = record.split(FIELD);
    const hasBody = maybeParents !== undefined;
    return {
      hash,
      shortHash,
      date,
      author,
      email,
      subject,
      body: hasBody ? bodyOrParents.trim() : "",
      parents: (hasBody ? maybeParents : bodyOrParents).trim().split(/\s+/).filter(Boolean)
    };
  });
}

export function parseCommitLogWithStats(stdout) {
  return stdout.split(RECORD).map((record) => record.trim()).filter(Boolean).map((record) => {
    const [header, ...numstatLines] = record.split(/\r?\n/);
    const commit = parseCommitLog(header)[0];
    return { ...commit, ...parseNumstat(numstatLines.join("\n")) };
  });
}

export function parseNumstat(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).reduce((totals, line) => {
    const [added, deleted] = line.split("\t");
    if (/^\d+$/.test(added)) totals.additions += Number(added);
    if (/^\d+$/.test(deleted)) totals.deletions += Number(deleted);
    totals.filesChanged += 1;
    return totals;
  }, { additions: 0, deletions: 0, filesChanged: 0 });
}

export function parseChangedFiles(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, firstPath, secondPath] = line.split("\t");
    return {
      status,
      path: secondPath || firstPath,
      previousPath: secondPath ? firstPath : ""
    };
  });
}

export function safeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || path.posix.isAbsolute(normalized)) {
    throw new Error("A relative file path is required");
  }
  const clean = path.posix.normalize(normalized);
  if (clean === ".." || clean.startsWith("../")) throw new Error("File path must stay inside the project root");
  return clean;
}

async function gitRoot(projectRoot) {
  const root = path.resolve(projectRoot);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Invalid project root: ${root}`);
  return (await runGit(root, ["rev-parse", "--show-toplevel"])).trim();
}

function assertCommit(commit) {
  if (!/^[0-9a-f]{7,64}$/i.test(String(commit || ""))) throw new Error("Invalid commit id");
}

async function runGit(root, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error("Git output exceeded the 4 MB safety limit");
    throw new Error((error?.stderr || error?.message || "Git command failed").trim());
  }
}
