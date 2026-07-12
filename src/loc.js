import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".sass",
  ".less", ".html", ".htm", ".yml", ".yaml", ".toml", ".md", ".txt", ".sql", ".prisma",
  ".py", ".pyi"
]);

const SKIP_DIRECTORIES = new Set([
  ".git", ".next", ".cache", "node_modules", "dist", "build", "coverage", ".turbo", ".output",
  "out", "tmp", "__pycache__", ".venv", "venv"
]);

export async function analyzeLoc(projectRoot) {
  const root = path.resolve(projectRoot);
  await assertDirectory(root);
  const files = await projectFiles(root);
  const areas = new Map();
  const modules = new Map();
  const extensions = new Map();
  const tree = makeTree("src");
  const totals = { files: 0, codeFiles: 0, testFiles: 0, code: 0, tests: 0, lines: 0 };

  for (const relativePath of files) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (!normalized.startsWith("src/")) continue;
    const parts = normalized.split("/");
    if (parts.some((part) => SKIP_DIRECTORIES.has(part))) continue;
    const extension = path.extname(normalized).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) continue;

    const lines = await countLines(path.join(root, normalized));
    if (lines === 0) continue;
    const test = isTestPath(normalized);
    totals.files += 1;
    totals[test ? "testFiles" : "codeFiles"] += 1;
    totals.lines += lines;
    totals[test ? "tests" : "code"] += lines;

    addBucket(extensions, extension.slice(1) || "other", lines, test);
    const isModule = parts[1] === "modules" && parts.length > 3;
    const areaName = isModule ? "modules" : parts[1];
    addBucket(areas, areaName, lines, test);
    if (isModule) addBucket(modules, parts[2], lines, test);
    addTreePath(tree, isModule ? ["modules", parts[2]] : [parts[1]], lines, test);
  }

  return {
    root,
    scope: "src/",
    totals,
    testPercent: totals.lines ? Math.round((totals.tests / totals.lines) * 1000) / 10 : 0,
    areas: sortedBuckets(areas),
    modules: sortedBuckets(modules),
    extensions: sortedBuckets(extensions),
    tree: finalizeTree(tree)
  };
}

export function isTestPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const file = path.basename(normalized);
  return normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes("/__tests__/") ||
    normalized.includes("/spec/") || normalized.includes("/__specs__/") ||
    /\.(test|spec)\./.test(file) || /^(test_.+|.+_test)\.py$/.test(file);
}

function addBucket(map, name, lines, test) {
  if (!map.has(name)) map.set(name, { name, files: 0, code: 0, tests: 0, lines: 0 });
  const bucket = map.get(name);
  bucket.files += 1;
  bucket.lines += lines;
  bucket[test ? "tests" : "code"] += lines;
}

function sortedBuckets(map) {
  return [...map.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
}

function makeTree(name) {
  return { name, code: 0, tests: 0, lines: 0, children: new Map() };
}

function addTreePath(root, parts, lines, test) {
  root.lines += lines;
  root[test ? "tests" : "code"] += lines;
  let current = root;
  for (const part of parts.filter(Boolean)) {
    if (!current.children.has(part)) current.children.set(part, makeTree(part));
    current = current.children.get(part);
    current.lines += lines;
    current[test ? "tests" : "code"] += lines;
  }
}

function finalizeTree(node) {
  return {
    name: node.name,
    code: node.code,
    tests: node.tests,
    lines: node.lines,
    children: [...node.children.values()]
      .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name))
      .map(finalizeTree)
  };
}

async function projectFiles(root) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-co", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return walk(root);
  }
}

async function walk(root, directory = root, files = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, absolutePath, files);
    if (entry.isFile()) files.push(path.relative(root, absolutePath));
  }
  return files;
}

async function countLines(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

async function assertDirectory(directory) {
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Invalid project root: ${directory}`);
}
