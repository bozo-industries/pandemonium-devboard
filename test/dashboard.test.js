import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { analyzeLoc, isTestPath } from "../src/loc.js";
import { parseTokenUsage } from "../src/tokenUsage.js";
import { commitDetails, commitFileDiff, parseNumstat, recentCommits, safeRelativePath } from "../src/git.js";
import { normalizeSshTarget } from "../src/localSettings.js";
import { deleteTodo, loadTodoBoard, saveTodoDocument } from "../src/todos.js";

test("LOC analysis splits source and tests and groups modules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-loc-"));
  await fs.mkdir(path.join(root, "src", "modules", "alpha", "test"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "server"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "runtime"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "ui"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "daemon"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "index.js"), "one\ntwo\n", "utf8");
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "test", "index.test.js"), "one\n", "utf8");
  await fs.writeFile(path.join(root, "src", "server", "main.py"), "one\ntwo\nthree", "utf8");
  await fs.writeFile(path.join(root, "src", "runtime", "index.js"), "runtime", "utf8");
  await fs.writeFile(path.join(root, "src", "ui", "index.js"), "ui", "utf8");
  await fs.writeFile(path.join(root, "src", "daemon", "index.js"), "daemon", "utf8");
  await fs.writeFile(path.join(root, "outside.js"), "ignored", "utf8");

  const result = await analyzeLoc(root);
  assert.equal(result.totals.files, 6);
  assert.equal(result.totals.codeFiles, 5);
  assert.equal(result.totals.testFiles, 1);
  assert.equal(result.totals.code, 9);
  assert.equal(result.totals.tests, 2);
  assert.equal(result.modules[0].name, "alpha");
  assert.equal(result.modules[0].lines, 5);
  assert.equal(result.extensions.find((item) => item.name === "py").lines, 3);
  assert.deepEqual(
    result.areas.filter((item) => ["runtime", "ui", "daemon"].includes(item.name)).map((item) => item.name).sort(),
    ["daemon", "runtime", "ui"]
  );
});

test("test path detection supports common directory and filename conventions", () => {
  assert.equal(isTestPath("src/foo/__tests__/thing.js"), true);
  assert.equal(isTestPath("src/modules/yapbridge/tests/test_state.py"), true);
  assert.equal(isTestPath("src/foo/test_helpers.py"), true);
  assert.equal(isTestPath("src/foo/thing.spec.ts"), true);
  assert.equal(isTestPath("src/foo/contest.ts"), false);
});

test("token usage parser normalizes totals and recent daily rows", () => {
  const result = parseTokenUsage({
    totals: { inputTokens: 100, outputTokens: 20, reasoningOutputTokens: 5, cacheReadTokens: 300, totalTokens: 420, costUSD: 1.25 },
    daily: [
      { date: "2026-07-11", models: ["gpt-5"], totalTokens: 200, costUSD: 0.5 },
      { date: "2026-07-12", models: "gpt-5-codex", totalTokens: 220, costUSD: 0.75 }
    ]
  });
  assert.deepEqual(result.totals, {
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 5,
    cacheReadTokens: 300,
    totalTokens: 420,
    costUSD: 1.25
  });
  assert.equal(result.daily[0].date, "2026-07-12");
  assert.deepEqual(result.daily[0].models, ["gpt-5-codex"]);
});

test("Git history exposes commits, changed files, and bounded per-file patches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-git-"));
  git(root, ["init"]);
  git(root, ["config", "user.name", "Dashboard Test"]);
  git(root, ["config", "user.email", "dashboard@example.test"]);
  await fs.writeFile(path.join(root, "hello.txt"), "first\n", "utf8");
  git(root, ["add", "hello.txt"]);
  git(root, ["commit", "-m", "Initial file"]);
  await fs.writeFile(path.join(root, "hello.txt"), "first\nsecond\n", "utf8");
  git(root, ["commit", "-am", "Extend file"]);

  const history = await recentCommits(root, 10);
  assert.equal(history.commits.length, 2);
  assert.equal(history.commits[0].subject, "Extend file");
  assert.deepEqual(
    { additions: history.commits[0].additions, deletions: history.commits[0].deletions, filesChanged: history.commits[0].filesChanged },
    { additions: 1, deletions: 0, filesChanged: 1 }
  );

  const details = await commitDetails(root, history.commits[0].hash);
  assert.equal(details.files[0].path, "hello.txt");
  assert.equal(details.files[0].status, "M");

  const diff = await commitFileDiff(root, history.commits[0].hash, "hello.txt");
  assert.match(diff.patch, /\+second/);
  assert.throws(() => safeRelativePath("../secret.txt"), /inside the project root/);
});

test("numstat parser totals additions, deletions, and binary file entries", () => {
  assert.deepEqual(parseNumstat("10\t2\tsrc/a.js\n-\t-\tasset.png\n"), {
    additions: 10,
    deletions: 2,
    filesChanged: 2
  });
});

test("local SSH settings are normalized without retaining unknown fields", () => {
  assert.deepEqual(normalizeSshTarget({
    host: " user@example.test ",
    identityFile: 42,
    projectRoot: "/project ",
    liveEnvRoot: "/etc/project",
    rootEnvPath: "/etc/project.env",
    sudo: 1,
    ignored: "value"
  }), {
    host: "user@example.test",
    identityFile: "",
    projectRoot: "/project",
    liveEnvRoot: "/etc/project",
    rootEnvPath: "/etc/project.env",
    sudo: true
  });
});

test("Todo plans attach a docs/todo document and link the README title", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-todo-"));
  git(root, ["init"]);
  git(root, ["config", "user.name", "Dashboard Test"]);
  git(root, ["config", "user.email", "dashboard@example.test"]);
  await fs.writeFile(path.join(root, "README.md"), "# Project\n\n## TODO\n\n- Keep docs aligned\n\n## Next\n", "utf8");

  const before = await loadTodoBoard(root);
  assert.equal(before.todos.length, 1);
  assert.equal(before.todos[0].docPath, "");

  const after = await saveTodoDocument(root, before.todos[0].id, "# Keep docs aligned\n\nDetailed plan.\n");
  assert.equal(after.todos[0].docPath, "docs/todo/keep-docs-aligned.md");
  assert.equal(await fs.readFile(path.join(root, after.todos[0].docPath), "utf8"), "# Keep docs aligned\n\nDetailed plan.\n");
  assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /\[Keep docs aligned\]\(docs\/todo\/keep-docs-aligned\.md\)/);
});

test("Removing a Todo deletes its README entry and attached plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-todo-remove-"));
  git(root, ["init"]);
  await fs.writeFile(path.join(root, "README.md"), "# Project\n\n## TODO\n\n- [Keep docs aligned](docs/todo/keep-docs-aligned.md)\n\n## Next\n", "utf8");
  await fs.mkdir(path.join(root, "docs", "todo"), { recursive: true });
  const planPath = path.join(root, "docs", "todo", "keep-docs-aligned.md");
  await fs.writeFile(planPath, "# Keep docs aligned\n", "utf8");

  const board = await loadTodoBoard(root);
  const after = await deleteTodo(root, board.todos[0].id);
  assert.equal(after.todos.length, 0);
  assert.doesNotMatch(await fs.readFile(path.join(root, "README.md"), "utf8"), /Keep docs aligned/);
  await assert.rejects(fs.access(planPath), { code: "ENOENT" });
});

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}
