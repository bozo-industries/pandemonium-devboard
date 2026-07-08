import fs from "node:fs/promises";
import path from "node:path";
import { buildRows, readEnvFile } from "./env.js";
import { docsForFile, explainRowsWithDocs, loadConfigDocs } from "./docs.js";
import { githubFileExists, readExampleEnvFile } from "./githubExamples.js";

export const DEFAULT_PROJECT_ROOT = "C:\\Users\\user\\Documents\\Bahnapp-calendar-bridge";

export async function scanPandemoniumProject(projectRoot) {
  const root = path.resolve(projectRoot || DEFAULT_PROJECT_ROOT);
  await assertProjectRoot(root);

  const docs = await loadConfigDocs(root);
  const files = [];

  files.push(await buildEnvFile(root, {
    id: "root:.env",
    group: "Daemon",
    owner: "Root daemon bootstrap",
    envPath: ".env",
    examplePath: ".env.example",
    descriptorPath: ""
  }, docs));

  files.push(await buildEnvFile(root, {
    id: "daemon:secrets/daemon.env",
    group: "Daemon",
    owner: "Daemon",
    envPath: "secrets/daemon.env",
    examplePath: "deploy/env/daemon.env.example",
    descriptorPath: ""
  }, docs));

  for (const moduleInfo of await discoverModules(root)) {
    for (const envPath of moduleInfo.envFiles) {
      files.push(await buildEnvFile(root, {
        id: `${moduleInfo.id}:${envPath}`,
        group: moduleInfo.name,
        owner: moduleInfo.name,
        envPath,
        examplePath: await findExamplePath(root, envPath, moduleInfo),
        descriptorPath: moduleInfo.descriptorPath
      }, docs));
    }
  }

  return {
    projectRoot: root,
    files
  };
}

export async function discoverModules(projectRoot) {
  const modulesRoot = path.join(projectRoot, "src", "modules");
  const modules = [];
  let entries = [];
  try {
    entries = await fs.readdir(modulesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const descriptorPath = path.join(modulesRoot, entry.name, "pandemonium-module.json");
    const descriptor = await readJsonIfExists(descriptorPath);
    if (!descriptor?.id || !Array.isArray(descriptor.envFiles)) {
      continue;
    }
    modules.push({
      id: descriptor.id,
      name: descriptor.name || descriptor.id,
      envFiles: descriptor.envFiles,
      descriptorPath: path.relative(projectRoot, descriptorPath).replaceAll("\\", "/"),
      moduleDir: path.join("src", "modules", entry.name).replaceAll("\\", "/")
    });
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findExamplePath(projectRoot, envPath, moduleInfo) {
  const normalized = envPath.replaceAll("\\", "/");
  const baseName = path.posix.basename(normalized);
  const candidates = [
    `deploy/env/${baseName}.example`,
    `deploy/env/${baseName.replace(/\.env$/, "")}.env.example`,
    `${moduleInfo.moduleDir}/.env.example`
  ];

  for (const candidate of candidates) {
    if (await githubFileExists(candidate)) {
      return candidate;
    }
    try {
      await fs.access(path.join(projectRoot, candidate));
      return candidate;
    } catch {
      // Continue through known template locations.
    }
  }
  return "";
}

async function buildEnvFile(projectRoot, fileInfo, docs) {
  const actualPath = path.join(projectRoot, fileInfo.envPath);
  const examplePath = fileInfo.examplePath ? path.join(projectRoot, fileInfo.examplePath) : "";
  const [actualParsed, exampleParsed] = await Promise.all([
    readEnvFile(actualPath),
    fileInfo.examplePath ? readExampleEnvFile(fileInfo.examplePath, examplePath) : Promise.resolve({ entries: [], values: {} })
  ]);
  const fileDocs = docsForFile(fileInfo.envPath, docs);
  const rows = explainRowsWithDocs(buildRows(exampleParsed, actualParsed), fileDocs);

  return {
    ...fileInfo,
    envPath: fileInfo.envPath.replaceAll("\\", "/"),
    examplePath: fileInfo.examplePath.replaceAll("\\", "/"),
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

async function assertProjectRoot(projectRoot) {
  const packageJson = await readJsonIfExists(path.join(projectRoot, "package.json"));
  const hasModules = await exists(path.join(projectRoot, "src", "modules"));
  const hasEnvExample = await exists(path.join(projectRoot, ".env.example"));
  if (packageJson?.name !== "pandemonium" || !hasModules || !hasEnvExample) {
    throw new Error("This does not look like the Pandemonium/Bahnapp project root.");
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(stripBom(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
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
