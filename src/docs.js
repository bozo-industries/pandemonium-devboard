import path from "node:path";
import { readConfigDocs } from "./githubExamples.js";

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

export async function loadConfigDocs(projectRoot) {
  const markdown = await readConfigDocs(path.join(projectRoot, "docs", "configuration.md"));
  return {
    markdown,
    sections: splitMarkdownSections(markdown)
  };
}

export function docsForFile(relativePath, docs) {
  const normalized = normalizePath(relativePath);
  const title = FILE_SECTION_TITLES.get(normalized);
  if (!title) {
    return "";
  }
  return docs.sections.get(title) ?? "";
}

export function explainRowsWithDocs(rows, fileDocs) {
  return rows.map((row) => ({
    ...row,
    docs: explanationForKey(row.key, fileDocs)
  }));
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

function explanationForKey(key, markdown) {
  if (!markdown) {
    return "";
  }

  const lines = markdown.split(/\r?\n/);
  const direct = lines.find((line) => line.includes(`\`${key}\``));
  if (direct) {
    return cleanMarkdownLine(direct);
  }

  const codeIndex = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (codeIndex > -1) {
    const nearby = [];
    for (let index = Math.max(0, codeIndex - 3); index < codeIndex; index += 1) {
      const line = lines[index].trim();
      if (line && !line.startsWith("```") && !/^[A-Z0-9_]+=/.test(line)) {
        nearby.push(cleanMarkdownLine(line));
      }
    }
    return nearby.join(" ");
  }

  const prefix = key.split("_").slice(0, 2).join("_");
  const prefixLine = lines.find((line) => line.includes(prefix) && !line.startsWith("```"));
  return prefixLine ? cleanMarkdownLine(prefixLine) : "";
}

function cleanMarkdownLine(line) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}
