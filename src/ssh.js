import { spawn } from "node:child_process";
import { ENV_DOCS_PARSER_SOURCE } from "./envDocsParser.js";

export const DEFAULT_SSH_TARGET = {
  host: "",
  identityFile: "",
  projectRoot: "",
  liveEnvRoot: "",
  rootEnvPath: "",
  sudo: false
};

export async function detectSshPandemoniumTarget(target) {
  const config = normalizeTarget(target);
  const script = `${remoteDetectorSource()}\ndetect(${JSON.stringify(config)}).then((result)=>process.stdout.write(JSON.stringify(result))).catch((error)=>{console.error(error && error.stack || String(error)); process.exit(1);});`;
  return JSON.parse(await runRemoteNode(config, script));
}

export async function scanPandemoniumProjectOverSsh(target) {
  const config = normalizeTarget(target);
  const script = `${remoteScannerSource()}\nscan(${JSON.stringify(config)}).then((result)=>process.stdout.write(JSON.stringify(result))).catch((error)=>{console.error(error && error.stack || String(error)); process.exit(1);});`;
  return JSON.parse(await runRemoteNode(config, script));
}

export async function saveEnvFileOverSsh(target, envPath, values, deleteKeys = []) {
  const config = normalizeTarget(target);
  const payload = { config, envPath, values, deleteKeys };
  const script = `${remoteScannerSource()}\nsave(${JSON.stringify(payload)}).then((result)=>process.stdout.write(JSON.stringify(result))).catch((error)=>{console.error(error && error.stack || String(error)); process.exit(1);});`;
  return JSON.parse(await runRemoteNode(config, script));
}

function normalizeTarget(target = {}) {
  return {
    host: String(target.host || DEFAULT_SSH_TARGET.host).trim(),
    identityFile: String(target.identityFile || DEFAULT_SSH_TARGET.identityFile).trim(),
    projectRoot: String(target.projectRoot || DEFAULT_SSH_TARGET.projectRoot).trim(),
    liveEnvRoot: String(target.liveEnvRoot || DEFAULT_SSH_TARGET.liveEnvRoot).trim(),
    rootEnvPath: String(target.rootEnvPath || DEFAULT_SSH_TARGET.rootEnvPath).trim(),
    sudo: Boolean(target.sudo)
  };
}

function runRemoteNode(config, script) {
  if (!config.host) {
    throw new Error("SSH host is required");
  }
  return new Promise((resolve, reject) => {
    const remoteCommand = config.sudo ? ["sudo", "-n", "node", "-"] : ["node", "-"];
    const sshArgs = [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      ...(config.identityFile ? ["-i", config.identityFile] : []),
      config.host,
      ...remoteCommand
    ];
    const child = spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `ssh exited with ${code}`));
      }
    });
    child.stdin.end(script, "utf8");
  });
}

function remoteScannerSource() {
  return String.raw`
${ENV_DOCS_PARSER_SOURCE}
const fs = require("node:fs/promises");
const path = require("node:path");
const PANDEMONIUM_GITHUB_RAW_BASE = "https://raw.githubusercontent.com/bozo-industries/Pandemonium/master";
const githubTextCache = new Map();

async function scan(config) {
  await assertProjectRoot(config.projectRoot);
  const docs = await loadConfigDocs(config.projectRoot);
  const files = [];
  files.push(await buildEnvFile(config, {
    id: "root:.env",
    group: "Daemon",
    owner: "Root daemon bootstrap",
    envPath: ".env",
    examplePath: ".env.example",
    descriptorPath: ""
  }, docs));
  files.push(await buildEnvFile(config, {
    id: "daemon:secrets/daemon.env",
    group: "Daemon",
    owner: "Daemon",
    envPath: "secrets/daemon.env",
    examplePath: "deploy/env/daemon.env.example",
    descriptorPath: ""
  }, docs));
  for (const moduleInfo of await discoverModules(config.projectRoot)) {
    for (const envPath of moduleInfo.envFiles) {
      files.push(await buildEnvFile(config, {
        id: moduleInfo.id + ":" + envPath,
        group: moduleInfo.name,
        owner: moduleInfo.name,
        envPath,
        examplePath: await findExamplePath(config.projectRoot, envPath, moduleInfo),
        descriptorPath: moduleInfo.descriptorPath
      }, docs));
    }
  }
  return {
    projectRoot: config.projectRoot,
    target: { mode: "ssh", host: config.host, projectRoot: config.projectRoot, liveEnvRoot: config.liveEnvRoot, rootEnvPath: config.rootEnvPath, sudo: config.sudo },
    files
  };
}

async function save(payload) {
  const targetPath = await livePathFor(payload.config, payload.envPath);
  await writeEnvFile(targetPath, payload.values || {}, { deleteKeys: payload.deleteKeys || [] });
  return scan(payload.config);
}

async function discoverModules(projectRoot) {
  const modulesRoot = path.posix.join(projectRoot, "src", "modules");
  let entries = [];
  try {
    entries = await fs.readdir(modulesRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const modules = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const descriptorPath = path.posix.join(modulesRoot, entry.name, "pandemonium-module.json");
    const descriptor = await readJsonIfExists(descriptorPath);
    if (!descriptor || !descriptor.id || !Array.isArray(descriptor.envFiles)) continue;
    modules.push({
      id: descriptor.id,
      name: descriptor.name || descriptor.id,
      envFiles: descriptor.envFiles,
      descriptorPath: path.posix.relative(projectRoot, descriptorPath),
      moduleDir: path.posix.join("src", "modules", entry.name)
    });
  }
  return modules.sort((a, b) => a.name.localeCompare(b.name));
}

async function findExamplePath(projectRoot, envPath, moduleInfo) {
  const normalized = envPath.replaceAll("\\", "/");
  const baseName = path.posix.basename(normalized);
  const candidates = [
    "deploy/env/" + baseName + ".example",
    "deploy/env/" + baseName.replace(/\.env$/, "") + ".env.example",
    moduleInfo.moduleDir + "/.env.example"
  ];
  for (const candidate of candidates) {
    if (await githubFileExists(candidate)) {
      return candidate;
    }
    try {
      await fs.access(path.posix.join(projectRoot, candidate));
      return candidate;
    } catch {}
  }
  return "";
}

async function buildEnvFile(config, fileInfo, docs) {
  const actualPath = await livePathFor(config, fileInfo.envPath);
  const examplePath = fileInfo.examplePath ? path.posix.join(config.projectRoot, fileInfo.examplePath) : "";
  const actualParsed = await readEnvFile(actualPath);
  const exampleParsed = fileInfo.examplePath ? await readExampleEnvFile(fileInfo.examplePath, examplePath) : { entries: [], values: {} };
  const fileDocs = docsForFile(fileInfo.envPath, docs);
  const rows = explainRowsWithDocs(buildRows(exampleParsed, actualParsed), fileDocs);
  return {
    ...fileInfo,
    envPath: fileInfo.envPath.replaceAll("\\", "/"),
    examplePath: fileInfo.examplePath.replaceAll("\\", "/"),
    livePath: actualPath,
    exists: actualParsed.entries.length > 0,
    exampleExists: exampleParsed.entries.length > 0,
    stats: {
      total: rows.length,
      set: rows.filter((row) => row.status === "set").length,
      empty: rows.filter((row) => row.status === "empty").length,
      missing: rows.filter((row) => row.status === "missing").length
    },
    docs: fileDocs,
    rows
  };
}

async function livePathFor(config, envPath) {
  const normalized = envPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized === ".env") return config.rootEnvPath || path.posix.join(config.projectRoot, ".env");
  if (normalized === "secrets/daemon.env" && config.liveEnvRoot) {
    const liveRootPath = path.posix.join(config.liveEnvRoot, path.posix.basename(normalized));
    if (await exists(liveRootPath)) return liveRootPath;
  }
  return path.posix.join(config.projectRoot, normalized);
}

async function assertProjectRoot(projectRoot) {
  const packageJson = await readJsonIfExists(path.posix.join(projectRoot, "package.json"));
  const hasModules = await exists(path.posix.join(projectRoot, "src", "modules"));
  const hasEnvExample = await exists(path.posix.join(projectRoot, ".env.example"));
  if (!packageJson || packageJson.name !== "pandemonium" || !hasModules || !hasEnvExample) {
    throw new Error("This does not look like the Pandemonium/Bahnapp project root.");
  }
}

async function loadConfigDocs(projectRoot) {
  const markdown = await githubText("docs/reference/configuration.md")
    || await githubText("docs/configuration.md")
    || await readTextIfExists(path.posix.join(projectRoot, "docs", "reference", "configuration.md"))
    || await readTextIfExists(path.posix.join(projectRoot, "docs", "configuration.md"));
  const moduleDocs = new Map();
  for (const docPath of MODULE_DOC_PATHS) {
    const text = await githubText(docPath) || await readTextIfExists(path.posix.join(projectRoot, docPath));
    if (text) moduleDocs.set(docPath, text);
  }
  return { markdown, sections: splitMarkdownSections(markdown), moduleDocs };
}

async function readExampleEnvFile(relativePath, localFallbackPath) {
  const text = await githubText(relativePath);
  if (text) return parseEnv(text);
  return localFallbackPath ? readEnvFile(localFallbackPath) : { entries: [], values: {} };
}

async function githubFileExists(relativePath) {
  return (await githubText(relativePath)) !== "";
}

async function githubText(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized) return "";
  if (githubTextCache.has(normalized)) return githubTextCache.get(normalized);
  const response = await fetch(PANDEMONIUM_GITHUB_RAW_BASE + "/" + normalized.split("/").map(encodeURIComponent).join("/") + "?v=" + Date.now(), {
    headers: { "cache-control": "no-cache" }
  });
  if (!response.ok) {
    if (response.status === 404) {
      githubTextCache.set(normalized, "");
      return "";
    }
    throw new Error("GitHub example fetch failed for " + normalized + ": HTTP " + response.status);
  }
  const text = await response.text();
  githubTextCache.set(normalized, text);
  return text;
}

const FILE_SECTION_TITLES = new Map([
  [".env", "Daemon Env"],
  ["secrets/daemon.env", "Daemon Env"],
  ["secrets/calendar.env", "Calendar Env"],
  ["secrets/email.env", "Email Env"],
  ["secrets/finance.env", "Finance Env"],
  ["secrets/public-transport.env", "Public Transport Env"],
  ["secrets/public-transport-discord.env", "Public Transport Env"],
  ["secrets/work.env", "Work Env"],
  ["secrets/yapbridge.env", "Yapbridge Env"]
]);

const FILE_MODULE_DOCS = new Map([
  ["secrets/calendar.env", "docs/modules/calendar.md"],
  ["secrets/email.env", "docs/modules/email.md"],
  ["secrets/finance.env", "docs/modules/finance.md"],
  ["secrets/public-transport.env", "docs/modules/public-transport.md"],
  ["secrets/work.env", "docs/modules/work.md"],
  ["secrets/yapbridge.env", "docs/modules/yapbridge.md"]
]);

const MODULE_DOC_PATHS = [...new Set(FILE_MODULE_DOCS.values())];

function docsForFile(relativePath, docs) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const chunks = [];
  const title = FILE_SECTION_TITLES.get(normalized);
  if (title && docs.sections.has(title)) {
    chunks.push(docs.sections.get(title));
  } else {
    chunks.push(...configSectionsForFile(normalized, docs.sections));
  }
  const moduleDocPath = FILE_MODULE_DOCS.get(normalized);
  if (moduleDocPath && docs.moduleDocs && docs.moduleDocs.has(moduleDocPath)) {
    chunks.push(docs.moduleDocs.get(moduleDocPath));
  }
  return chunks.filter(Boolean).join("\n\n").trim();
}

function splitMarkdownSections(markdown) {
  const sections = new Map();
  const lines = markdown.split(/\r?\n/);
  let currentTitle = "";
  let buffer = [];
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (currentTitle) sections.set(currentTitle, buffer.join("\n").trim());
      currentTitle = match[1].trim();
      buffer = [line];
    } else if (currentTitle) {
      buffer.push(line);
    }
  }
  if (currentTitle) sections.set(currentTitle, buffer.join("\n").trim());
  return sections;
}

function configSectionsForFile(relativePath, sections) {
  const names = ["Env Ownership", "Module Env Files"];
  if (relativePath === ".env" || relativePath === "secrets/daemon.env") {
    names.push("Control and Public Gateway", "Storage", "Paths");
  } else {
    names.push("Provider Credentials");
  }
  return names.map((name) => sections.get(name)).filter(Boolean);
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(stripBom(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const hadTrailingNewline = /\r?\n$/.test(text);
  const entries = [];
  const values = {};
  let pendingComments = [];
  lines.forEach((raw, index) => {
    if (index === lines.length - 1 && raw === "" && hadTrailingNewline) return;
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
    const parsed = unquoteValue(match[2].trim());
    entries.push({ type: "pair", raw, key: match[1], value: parsed.value, quote: parsed.quote, comments: pendingComments });
    values[match[1]] = parsed.value;
    pendingComments = [];
  });
  return { entries, values, hadTrailingNewline };
}

async function readEnvFile(filePath) {
  return parseEnv(await readTextIfExists(filePath));
}

async function writeEnvFile(filePath, values, options = {}) {
  validateValues(values);
  const deleteKeys = validateDeleteKeys(options.deleteKeys || []);
  const existingText = await readTextIfExists(filePath);
  const parsed = parseEnv(existingText);
  const used = new Set();
  const nextLines = [];
  for (const entry of parsed.entries) {
    if (entry.type !== "pair") {
      nextLines.push(entry.raw);
      continue;
    }
    if (deleteKeys.has(entry.key)) {
      used.add(entry.key);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, entry.key)) {
      nextLines.push(formatPair(entry.key, values[entry.key], entry.quote));
      used.add(entry.key);
    } else {
      nextLines.push(entry.raw);
    }
  }
  const missing = Object.keys(values).filter((key) => !used.has(key) && !deleteKeys.has(key));
  if (missing.length > 0 && nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") nextLines.push("");
  for (const key of missing) nextLines.push(formatPair(key, values[key]));
  await fs.mkdir(path.posix.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, nextLines.join("\n") + "\n", "utf8");
}

function buildRows(exampleParsed, actualParsed) {
  const orderedKeys = [];
  for (const key of envKeys(exampleParsed)) if (!orderedKeys.includes(key)) orderedKeys.push(key);
  for (const key of envKeys(actualParsed)) if (!orderedKeys.includes(key)) orderedKeys.push(key);
  const exampleEntries = entriesByKey(exampleParsed);
  const actualEntries = entriesByKey(actualParsed);
  return orderedKeys.map((key) => {
    const exampleEntry = exampleEntries.get(key);
    const actualEntry = actualEntries.get(key);
    const exampleValue = exampleParsed.values[key] || "";
    const actualValue = actualParsed.values[key] || "";
    const hasActual = actualEntry !== undefined;
    return {
      key,
      exampleValue,
      actualValue,
      effectiveValue: hasActual ? actualValue : exampleValue,
      hasActual,
      hasExample: exampleEntry !== undefined,
      status: hasActual ? (actualValue === "" ? "empty" : "set") : "missing",
      comments: [...((exampleEntry && exampleEntry.comments) || []), ...((actualEntry && actualEntry.comments) || [])].filter(Boolean)
    };
  });
}

function envKeys(parsed) {
  return parsed.entries.filter((entry) => entry.type === "pair").map((entry) => entry.key);
}

function entriesByKey(parsed) {
  const map = new Map();
  for (const entry of parsed.entries) if (entry.type === "pair") map.set(entry.key, entry);
  return map;
}

function validateValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("values must be an object");
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("invalid env key: " + key);
    if (typeof value !== "string") throw new Error("value for " + key + " must be a string");
  }
}

function validateDeleteKeys(keys) {
  if (!Array.isArray(keys)) throw new Error("deleteKeys must be an array");
  const normalized = new Set();
  for (const key of keys) {
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("invalid env key: " + key);
    normalized.add(key);
  }
  return normalized;
}

function unquoteValue(value) {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) return { value: value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\""), quote: "\"" };
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return { value: value.slice(1, -1), quote: "'" };
  return { value, quote: "" };
}

function formatPair(key, value, quote = "") {
  if (quote === "\"") return key + "=\"" + value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, "\\\"") + "\"";
  if (quote === "'") return key + "='" + value.replace(/'/g, "'\\''") + "'";
  if (/\s|["#]/.test(value)) return key + "=\"" + value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, "\\\"") + "\"";
  return key + "=" + value;
}
`;
}

function remoteDetectorSource() {
  return String.raw`
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

async function detect(config) {
  const serviceName = config.serviceName || "pandemonium.service";
  const evidence = [];
  let show = "";
  let cat = "";
  try {
    show = cp.execFileSync("systemctl", ["show", serviceName, "-p", "FragmentPath", "-p", "WorkingDirectory", "-p", "ExecStart", "-p", "EnvironmentFiles"], { encoding: "utf8" });
    evidence.push("systemctl show " + serviceName);
  } catch (error) {
    evidence.push("systemctl show failed: " + cleanError(error));
  }
  try {
    cat = cp.execFileSync("systemctl", ["cat", serviceName], { encoding: "utf8" });
    evidence.push("systemctl cat " + serviceName);
  } catch (error) {
    evidence.push("systemctl cat failed: " + cleanError(error));
  }

  const props = parseSystemctlShow(show);
  const unit = parseSystemctlCat(cat);
  const projectRoot = await chooseProjectRoot([
    props.WorkingDirectory,
    unit.WorkingDirectory,
    ...execStartCandidates(props.ExecStart),
    ...execStartCandidates(unit.ExecStart),
    config.projectRoot,
    "/opt/pandemonium",
    "/home/user/Pandemonium"
  ]);

  const environmentFiles = [
    ...parseEnvironmentFiles(props.EnvironmentFiles),
    ...parseEnvironmentFiles(unit.EnvironmentFile),
    config.rootEnvPath,
    "/etc/pandemonium.env"
  ].filter(Boolean);
  const rootEnvPath = firstExisting(environmentFiles) || environmentFiles[0] || config.rootEnvPath;
  const rootEnvValues = rootEnvPath ? parseEnv(await readTextIfExists(rootEnvPath)).values : {};
  const serviceEnv = rootEnvValues.SERVICE_ENV_FILE_1 || "";
  const liveEnvRoot = serviceEnv
    ? path.posix.dirname(resolveRemotePath(path.posix.dirname(rootEnvPath || "/"), serviceEnv))
    : (config.liveEnvRoot || "/etc/pandemonium");

  return {
    host: config.host,
    identityFile: config.identityFile,
    projectRoot,
    liveEnvRoot,
    rootEnvPath,
    sudo: config.sudo,
    evidence
  };
}

function parseSystemctlShow(text) {
  const props = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > -1) props[line.slice(0, index)] = line.slice(index + 1);
  }
  return props;
}

function parseSystemctlCat(text) {
  const props = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (key === "EnvironmentFile") {
      props.EnvironmentFile = props.EnvironmentFile ? props.EnvironmentFile + " " + value : value;
    } else if (key === "WorkingDirectory" || key === "ExecStart") {
      props[key] = value;
    }
  }
  return props;
}

function parseEnvironmentFiles(value = "") {
  const matches = [];
  const pathRegex = /(?:path=)?(-?\/[^\s;"{}]+)/g;
  let match;
  while ((match = pathRegex.exec(value)) !== null) {
    matches.push(match[1].replace(/^-/, ""));
  }
  return [...new Set(matches)];
}

function execStartCandidates(value = "") {
  const candidates = [];
  const cwdMatch = value.match(/(?:^|\s)(\/[^\s;"']*pandemonium[^\s;"']*)/i);
  if (cwdMatch) {
    candidates.push(cwdMatch[1].replace(/\/dist\/.*$/, "").replace(/\/src\/.*$/, ""));
  }
  return candidates;
}

async function chooseProjectRoot(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    const normalized = candidate.replace(/^"|"$/g, "");
    if (await looksLikeProjectRoot(normalized)) return normalized;
  }
  return candidates.find(Boolean) || "/opt/pandemonium";
}

async function looksLikeProjectRoot(candidate) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.posix.join(candidate, "package.json"), "utf8"));
    await fs.access(path.posix.join(candidate, "src", "modules"));
    return packageJson.name === "pandemonium";
  } catch {
    return false;
  }
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      if (candidate && fss.existsSync(candidate)) return candidate;
    } catch {}
  }
  return "";
}

function resolveRemotePath(baseDir, value) {
  if (!value) return value;
  if (value.startsWith("/")) return value;
  return path.posix.resolve(baseDir || "/", value);
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "EACCES")) return "";
    throw error;
  }
}

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  }
  return { values };
}

function cleanError(error) {
  return String(error && (error.stderr || error.message) || error).trim().split(/\r?\n/)[0];
}
`;
}
