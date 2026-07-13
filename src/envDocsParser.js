export function createEnvDocsParser() {
  function cleanMarkdownLine(line, omitKey = "") {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      return trimmed
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.replace(/`/g, "").trim())
        .filter((cell) => cell && cell !== omitKey && !/^:?-{3,}:?$/.test(cell))
        .join(" ");
    }
    return trimmed
      .replace(/^[-*]\s+/, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function explanationForKey(key, markdown) {
    if (!markdown) return "";
    const lines = markdown.split(/\r?\n/);
    const direct = lines.find((line) => line.includes(`\`${key}\``));
    if (direct) return cleanMarkdownLine(direct, key);

    const codeIndex = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (codeIndex > -1) {
      const nearby = [];
      for (let index = Math.max(0, codeIndex - 3); index < codeIndex; index += 1) {
        const line = lines[index].trim();
        if (line && !line.startsWith("```") && !/^[A-Z0-9_]+=/.test(line)) nearby.push(cleanMarkdownLine(line));
      }
      return nearby.join(" ");
    }

    const prefix = key.split("_").slice(0, 2).join("_");
    const prefixLine = lines.find((line) => line.includes(prefix) && !line.startsWith("```"));
    return prefixLine ? cleanMarkdownLine(prefixLine) : "";
  }

  return function explainRowsWithDocs(rows, fileDocs) {
    return rows.map((row) => ({
      ...row,
      docs: explanationForKey(row.key, fileDocs)
    }));
  };
}

export const explainRowsWithDocs = createEnvDocsParser();
export const ENV_DOCS_PARSER_SOURCE = `const explainRowsWithDocs = (${createEnvDocsParser.toString()})();`;
