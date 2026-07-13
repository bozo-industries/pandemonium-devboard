import path from "node:path";
import { readConfigDocs, readProjectText } from "./githubExamples.js";
import { explainRowsWithDocs } from "./envDocsParser.js";

export { explainRowsWithDocs };

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

export async function loadConfigDocs(projectRoot) {
  const markdown = await readConfigDocs(path.join(projectRoot, "docs", "reference", "configuration.md"))
    || await readConfigDocs(path.join(projectRoot, "docs", "configuration.md"));
  const moduleDocs = new Map();
  await Promise.all(MODULE_DOC_PATHS.map(async (docPath) => {
    const text = await readProjectText(docPath, path.join(projectRoot, docPath));
    if (text) {
      moduleDocs.set(docPath, text);
    }
  }));
  return {
    markdown,
    sections: splitMarkdownSections(markdown),
    moduleDocs
  };
}

export function docsForFile(relativePath, docs) {
  const normalized = normalizePath(relativePath);
  const chunks = [];
  const title = FILE_SECTION_TITLES.get(normalized);
  if (title && docs.sections.has(title)) {
    chunks.push(docs.sections.get(title));
  } else {
    chunks.push(...configSectionsForFile(normalized, docs.sections));
  }
  const moduleDocPath = FILE_MODULE_DOCS.get(normalized);
  if (moduleDocPath && docs.moduleDocs?.has(moduleDocPath)) {
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
      if (currentTitle) {
        sections.set(currentTitle, buffer.join("\n").trim());
      }
      currentTitle = match[1].trim();
      buffer = [line];
      continue;
    }
    if (currentTitle) {
      buffer.push(line);
    }
  }
  if (currentTitle) {
    sections.set(currentTitle, buffer.join("\n").trim());
  }
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

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}
