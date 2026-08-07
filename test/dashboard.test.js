import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { analyzeLoc, isTestPath } from "../src/loc.js";
import { loadCodexSessionTitles, parseProjectTokenUsage, parseTokenUsage } from "../src/tokenUsage.js";
import { commitDetails, commitFileDiff, parseNumstat, recentCommits, safeRelativePath } from "../src/git.js";
import { loadCommitMemory, normalizeCommitMemory } from "../src/jolli.js";
import { normalizeSshTarget } from "../src/localSettings.js";
import { deleteTodo, isTodoCommitSubject, loadTodoBoard, pushTodoChanges, saveTodoDocument } from "../src/todos.js";
import { explainRowsWithDocs } from "../src/docs.js";

test("LOC analysis splits source and tests and groups modules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-loc-"));
  await fs.mkdir(path.join(root, "src", "modules", "alpha", "test"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "server"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "runtime"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "ui"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "daemon", "core"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "index.ts"), "one\ntwo\n", "utf8");
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "test", "index.test.ts"), "one\n", "utf8");
  await fs.writeFile(path.join(root, "src", "server", "main.py"), "one\ntwo\nthree", "utf8");
  await fs.writeFile(path.join(root, "src", "runtime", "index.ts"), "runtime", "utf8");
  await fs.writeFile(path.join(root, "src", "ui", "index.ts"), "ui", "utf8");
  await fs.writeFile(path.join(root, "src", "daemon", "core", "index.ts"), "daemon", "utf8");
  await fs.writeFile(path.join(root, "src", "daemon", "watchdog.ts"), "watchdog", "utf8");
  await fs.writeFile(path.join(root, "src", "README.md"), "documentation\nthat\nis\nnot\ncode", "utf8");
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "pandemonium-module.json"), "{\n  \"name\": \"alpha\"\n}", "utf8");
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "pyproject.toml"), "[project]\nname = \"alpha\"", "utf8");
  await fs.writeFile(path.join(root, "outside.js"), "ignored", "utf8");

  const result = await analyzeLoc(root);
  assert.equal(result.totals.files, 7);
  assert.equal(result.totals.codeFiles, 6);
  assert.equal(result.totals.testFiles, 1);
  assert.equal(result.totals.code, 10);
  assert.equal(result.totals.tests, 2);
  assert.equal(result.modules[0].name, "alpha");
  assert.equal(result.modules[0].lines, 5);
  assert.equal(result.extensions.find((item) => item.name === "py").lines, 3);
  assert.deepEqual(
    result.areas.filter((item) => ["runtime", "ui", "daemon"].includes(item.name)).map((item) => item.name).sort(),
    ["daemon", "runtime", "ui"]
  );
  const daemon = result.tree.children.find((item) => item.name === "daemon");
  assert.deepEqual(daemon.children.map((item) => item.name), ["core"]);
});

test("test path detection supports common directory and filename conventions", () => {
  assert.equal(isTestPath("src/foo/__tests__/thing.js"), true);
  assert.equal(isTestPath("src/testing/httpServer.ts"), true);
  assert.equal(isTestPath("src/modules/yapbridge/tests/test_state.py"), true);
  assert.equal(isTestPath("src/foo/test_helpers.py"), true);
  assert.equal(isTestPath("src/foo/thing.spec.ts"), true);
  assert.equal(isTestPath("src/foo/contest.ts"), false);
});

test("environment docs turn Markdown table rows into clean hints", () => {
  const [row] = explainRowsWithDocs([{ key: "SERVICE_STORAGE_ENABLED" }], "| Variable | Purpose |\n| --- | --- |\n| `SERVICE_STORAGE_ENABLED` | Enables the storage backend. |");
  assert.equal(row.docs, "Enables the storage backend.");
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

test("token usage parser scopes Codex sessions to local project attachment ids and titles", () => {
  const result = parseProjectTokenUsage({
    sessions: [
      {
        sessionFile: "rollout-2026-08-02T00-52-08-019fbf87-1220-7d80-a5ae-fc82bbacf8db",
        lastActivity: "2026-08-02T07:11:34.498Z",
        models: { "gpt-5.6-sol": {} },
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        cacheReadTokens: 300,
        totalTokens: 420,
        costUSD: 1.25
      },
      {
        sessionFile: "rollout-2026-08-02T10-52-08-019fbf89-1220-7d80-a5ae-fc82bbacf8dd",
        lastActivity: "2026-08-02T10:11:34.498Z",
        models: { "gpt-5.6-sol": {} },
        inputTokens: 40,
        outputTokens: 8,
        reasoningOutputTokens: 1,
        cacheReadTokens: 90,
        totalTokens: 138,
        costUSD: 0.5
      },
      {
        sessionFile: "rollout-2026-08-03T00-52-08-019fbf88-1220-7d80-a5ae-fc82bbacf8dc",
        lastActivity: "2026-08-03T07:11:34.498Z",
        models: { "gpt-5.5": {} },
        inputTokens: 900,
        outputTokens: 90,
        cacheReadTokens: 9000,
        totalTokens: 9990,
        costUSD: 9
      }
    ]
  }, new Set([
    "019fbf87-1220-7d80-a5ae-fc82bbacf8db",
    "019fbf89-1220-7d80-a5ae-fc82bbacf8dd"
  ]), "C:\\Users\\user\\Code\\Pandemonium", new Map([
    ["019fbf87-1220-7d80-a5ae-fc82bbacf8db", "Klarna x Finance Integration"],
    ["019fbf89-1220-7d80-a5ae-fc82bbacf8dd", "Finance follow-up"]
  ]));

  assert.equal(result.scope, "project");
  assert.equal(result.matchedSessions, 2);
  assert.deepEqual(result.totals, {
    inputTokens: 140,
    outputTokens: 28,
    reasoningTokens: 6,
    cacheReadTokens: 390,
    totalTokens: 558,
    costUSD: 1.75
  });
  assert.deepEqual(result.daily, [{
    date: "2026-08-02",
    lastActivity: "2026-08-02T10:11:34.498Z",
    sessionId: "019fbf89-1220-7d80-a5ae-fc82bbacf8dd",
    label: "Finance follow-up",
    models: ["gpt-5.6-sol"],
    inputTokens: 40,
    outputTokens: 8,
    reasoningTokens: 1,
    cacheReadTokens: 90,
    totalTokens: 138,
    costUSD: 0.5
  }, {
    date: "2026-08-02",
    lastActivity: "2026-08-02T07:11:34.498Z",
    sessionId: "019fbf87-1220-7d80-a5ae-fc82bbacf8db",
    label: "Klarna x Finance Integration",
    models: ["gpt-5.6-sol"],
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 5,
    cacheReadTokens: 300,
    totalTokens: 420,
    costUSD: 1.25
  }]);
});

test("token usage titles fall back to first real Codex user prompt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-codex-titles-"));
  const sessionFile = "rollout-2026-08-02T00-52-08-019fbf87-1220-7d80-a5ae-fc82bbacf8db";
  const sessionDir = path.join(root, "sessions", "2026", "08", "02");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(root, "session_index.jsonl"), "", "utf8");
  await fs.writeFile(path.join(sessionDir, `${sessionFile}.jsonl`), [
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>\nignore me" }, { type: "input_text", text: "AGENTS.md instructions\nignore me too" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the Finance dashboard ccusage names please" }] } })
  ].join("\n"), "utf8");

  const titles = await loadCodexSessionTitles([{
    sessionFile,
    sessionId: `2026/08/02/${sessionFile}`
  }], path.join(root, "session_index.jsonl"), root);

  assert.equal(titles.get("019fbf87-1220-7d80-a5ae-fc82bbacf8db"), "Fix the Finance dashboard ccusage names...");
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
  assert.equal(history.commits[0].pushed, false);
  assert.equal(history.unpushedCount, 2);
  assert.deepEqual(
    { additions: history.commits[0].additions, deletions: history.commits[0].deletions, filesChanged: history.commits[0].filesChanged },
    { additions: 1, deletions: 0, filesChanged: 1 }
  );

  const details = await commitDetails(root, history.commits[0].hash);
  assert.equal(details.files[0].path, "hello.txt");
  assert.equal(details.files[0].status, "M");
  assert.equal(details.pushed, false);

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

test("Jolli commit memory is normalized and missing summaries remain optional", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-jolli-"));
  const payload = {
    commitHash: "abcdef0123456789",
    generatedAt: "2026-07-18T08:48:45.706Z",
    recap: "Reduced repeated matching work.",
    jolliDocUrl: "https://jolli.example/memory",
    topics: [{ title: "Cache matching facts", category: "performance", importance: "major", filesAffected: ["src/matcher.js"] }]
  };
  const result = await loadCommitMemory(root, "abcdef0", async () => JSON.stringify(payload));
  assert.deepEqual(result, { available: true, memory: normalizeCommitMemory(payload) });
  assert.deepEqual(await loadCommitMemory(root, "abcdef0", async () => "No summary found"), { available: true, memory: null });
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
  assert.equal(before.pushAvailable, false);

  const after = await saveTodoDocument(root, before.todos[0].id, "# Keep docs aligned\n\nDetailed plan.\n");
  assert.equal(after.todos[0].docPath, "docs/todo/keep-docs-aligned.md");
  assert.equal(after.pushAvailable, false);
  assert.equal(await fs.readFile(path.join(root, after.todos[0].docPath), "utf8"), "# Keep docs aligned\n\nDetailed plan.\n");
  assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /\[Keep docs aligned\]\(docs\/todo\/keep-docs-aligned\.md\)/);
  git(root, ["add", "README.md", "docs/todo"]);
  git(root, ["commit", "-m", "Add Todo plan"]);
  const committed = await loadTodoBoard(root);
  assert.equal(committed.todos[0].history.created.shortHash, committed.todos[0].history.lastEdited.shortHash);
  assert.match(committed.todos[0].history.lastEdited.date, /^\d{4}-\d{2}-\d{2}T/);
});

test("Todo plans can be created and renamed from the dashboard", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-todo-create-"));
  git(root, ["init"]);
  await fs.writeFile(path.join(root, "README.md"), "# Project\n\n## TODO\n\n## Next\n", "utf8");

  const created = await saveTodoDocument(root, "", "# Ship dashboard\n", "Ship dashboard");
  assert.equal(created.todos[0].title, "Ship dashboard");
  assert.equal(created.todos[0].docPath, "docs/todo/ship-dashboard.md");

  const renamed = await saveTodoDocument(root, created.todos[0].id, "# Ship dashboard\n", "Ship local dashboard");
  assert.equal(renamed.todos[0].title, "Ship local dashboard");
  assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /\[Ship local dashboard\]\(docs\/todo\/ship-dashboard\.md\)/);
});

test("Todo commit recognition only allows the required Todo prefix", () => {
  assert.equal(isTodoCommitSubject("[docs][todo][skip ci] update Todo plans"), true);
  assert.equal(isTodoCommitSubject("docs(todo): update Todo plans [skip ci]"), false);
  assert.equal(isTodoCommitSubject("Fix unrelated work"), false);
});

test("Todo push publishes Todo commits without pushing unrelated local commits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-todo-push-"));
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-todo-remote-"));
  git(remote, ["init", "--bare"]);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Dashboard Test"]);
  git(root, ["config", "user.email", "dashboard@example.test"]);
  await fs.writeFile(path.join(root, "README.md"), "# Project\n\n## TODO\n\n- Ship dashboard\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "Initial project"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-u", "origin", "master"]);
  await fs.writeFile(path.join(root, "pipeline.txt"), "unrelated work\n", "utf8");
  git(root, ["add", "pipeline.txt"]);
  git(root, ["commit", "-m", "Unrelated pipeline work"]);

  const board = await loadTodoBoard(root);
  await saveTodoDocument(root, board.todos[0].id, "# Ship dashboard\n");
  assert.equal((await loadTodoBoard(root)).pushAvailable, true);
  await pushTodoChanges(root);

  const remoteSubjects = execFileSync("git", ["--git-dir", remote, "log", "--format=%s", "master"], { encoding: "utf8", windowsHide: true });
  assert.match(remoteSubjects, /^\[docs\]\[todo\]\[skip ci\] update Todo plans/m);
  assert.doesNotMatch(remoteSubjects, /Unrelated pipeline work/);
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
