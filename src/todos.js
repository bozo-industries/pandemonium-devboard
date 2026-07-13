import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DOCUMENT_LENGTH = 1_000_000;
const TODO_COMMIT_PREFIX = "[docs][todo][skip ci] ";

export async function loadTodoBoard(projectRoot) {
  const root = await projectRootPath(projectRoot);
  const readmePath = path.join(root, "README.md");
  const text = await fs.readFile(readmePath, "utf8");
  const parsed = parseReadmeTodos(text);
  const githubBase = await githubBaseFor(root);
  const todos = await Promise.all(parsed.todos.map(async (todo) => ({
    ...todo,
    githubUrl: todo.docPath && githubBase ? `${githubBase}/${todo.docPath}` : "",
    history: todo.docPath ? await todoDocumentHistory(root, todo.docPath, githubBase) : null,
    content: todo.docPath ? await readTodoDocument(root, todo.docPath) : ""
  })));
  return { root, githubBase, todos };
}

export async function saveTodoDocument(projectRoot, todoId, content, title) {
  if (typeof content !== "string" || content.length > MAX_DOCUMENT_LENGTH) {
    throw new Error("Todo document must be text shorter than 1 MB");
  }
  const root = await projectRootPath(projectRoot);
  const readmePath = path.join(root, "README.md");
  const readme = await fs.readFile(readmePath, "utf8");
  const parsed = parseReadmeTodos(readme);
  const todo = parsed.todos.find((item) => item.id === todoId);
  const nextTitle = normalizeTodoTitle(title || todo?.title);
  const docPath = todo?.docPath || `docs/todo/${slugify(nextTitle)}.md`;
  const lines = readme.split(/\r?\n/);

  if (todo) {
    lines[todo.line] = todoLine(todo.prefix, nextTitle, docPath);
  } else {
    if (!title) throw new Error("Todo item not found in README.md");
    if (parsed.sectionEnd === -1) throw new Error("README.md must contain a TODO heading before adding a Todo");
    lines.splice(parsed.sectionEnd, 0, todoLine("- ", nextTitle, docPath));
  }

  const absoluteDocPath = safeTodoDocumentPath(root, docPath);
  await fs.mkdir(path.dirname(absoluteDocPath), { recursive: true });
  await fs.writeFile(absoluteDocPath, content || defaultTodoDocument(nextTitle), "utf8");
  await fs.writeFile(readmePath, `${lines.join("\n")}\n`, "utf8");
  return loadTodoBoard(root);
}

export async function deleteTodo(projectRoot, todoId) {
  const root = await projectRootPath(projectRoot);
  const readmePath = path.join(root, "README.md");
  const readme = await fs.readFile(readmePath, "utf8");
  const parsed = parseReadmeTodos(readme);
  const todo = parsed.todos.find((item) => item.id === todoId);
  if (!todo) throw new Error("Todo item not found in README.md");

  const lines = readme.split(/\r?\n/);
  lines.splice(todo.line, 1);
  await fs.writeFile(readmePath, `${lines.join("\n")}\n`, "utf8");

  if (todo.docPath && !parsed.todos.some((item) => item.id !== todo.id && item.docPath === todo.docPath)) {
    await fs.unlink(safeTodoDocumentPath(root, todo.docPath)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return loadTodoBoard(root);
}

export async function pushTodoChanges(projectRoot) {
  const root = await projectRootPath(projectRoot);
  const target = await todoPushTarget(root);
  await runGit(root, ["add", "--", "README.md", "docs/todo"]);
  const changed = await hasStagedChanges(root);
  if (changed) await runGit(root, ["commit", "-m", `${TODO_COMMIT_PREFIX}update Todo plans`]);
  const commits = await unpushedTodoCommits(root, target.upstream);
  if (!commits.length) throw new Error("There are no unpushed Todo commits to publish");

  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "dev-dashboard-todo-push-"));
  try {
    await runGit(root, ["worktree", "add", "--detach", worktree, target.upstream]);
    for (const commit of commits) await runGit(worktree, ["cherry-pick", commit.hash]);
    await runGit(worktree, ["push", target.remote, `HEAD:refs/heads/${target.branch}`], 60_000);
    return { commit: (await runGit(worktree, ["rev-parse", "--short", "HEAD"])).trim() };
  } catch (error) {
    await runGit(worktree, ["cherry-pick", "--abort"]).catch(() => undefined);
    throw error;
  } finally {
    await runGit(root, ["worktree", "remove", "--force", worktree]).catch(() => undefined);
    await fs.rm(worktree, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function isTodoCommitSubject(subject) {
  return String(subject || "").startsWith(TODO_COMMIT_PREFIX);
}

export function parseReadmeTodos(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+TODO\s*$/i.test(line));
  if (headingIndex === -1) return { todos: [], sectionEnd: -1 };
  const headingLevel = (lines[headingIndex].match(/^(#+)/) || [""])[1].length;
  const todos = [];
  let sectionEnd = lines.length;
  for (let line = headingIndex + 1; line < lines.length; line += 1) {
    const nextHeading = lines[line].match(/^(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= headingLevel) {
      sectionEnd = line;
      break;
    }
    const bullet = lines[line].match(/^(\s*[-*+]\s+)(.+)$/);
    if (!bullet) continue;
    const linked = bullet[2].trim().match(/^\[([^\]]+)\]\((docs\/todo\/[A-Za-z0-9._/-]+\.md)\)$/);
    const title = linked ? linked[1].trim() : markdownToText(bullet[2]);
    if (!title) continue;
    todos.push({
      id: `${line}:${slugify(title)}`,
      line,
      prefix: bullet[1],
      title,
      docPath: linked?.[2] || ""
    });
  }
  return { todos, sectionEnd };
}

export function defaultTodoDocument(title) {
  return `# ${title}\n\n## Goal\n\nDescribe the outcome this TODO should achieve.\n\n## Context\n\nRecord the relevant code, docs, constraints, and open questions.\n\n## Plan\n\n1. Identify the current behavior and affected boundaries.\n2. Make the smallest complete implementation change.\n3. Add or update focused tests and documentation.\n4. Verify the result in the relevant local or live surface.\n\n## Done when\n\n- [ ] The intended behavior is implemented.\n- [ ] Documentation is aligned with the current checkout.\n- [ ] Verification evidence is recorded here.\n`;
}

async function readTodoDocument(root, docPath) {
  try {
    return await fs.readFile(safeTodoDocumentPath(root, docPath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function todoDocumentHistory(root, docPath, githubBase) {
  const output = await runGit(root, ["log", "--follow", "--format=%H%x1f%h%x1f%aI", "--", docPath]).catch((error) => {
    if (/does not have any commits yet/i.test(error.message)) return "";
    throw error;
  });
  const commits = output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, shortHash, date] = line.split("\u001f");
    return {
      hash,
      shortHash,
      date,
      url: githubBase ? `${githubBase.replace(/\/blob\/HEAD$/, "/commit")}/${hash}` : ""
    };
  });
  return commits.length ? { created: commits.at(-1), lastEdited: commits[0] } : null;
}

function safeTodoDocumentPath(root, docPath) {
  if (!/^docs\/todo\/[A-Za-z0-9._/-]+\.md$/.test(docPath)) {
    throw new Error("Todo documents must stay in docs/todo and use a .md extension");
  }
  const resolved = path.resolve(root, docPath);
  if (!isInside(root, resolved)) throw new Error("Todo document must stay inside the project root");
  return resolved;
}

function markdownToText(value) {
  return value.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ");
}

function normalizeTodoTitle(value) {
  if (typeof value !== "string") throw new Error("Todo title is required");
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || title.length > 180 || /[\[\]\r\n]/.test(title)) {
    throw new Error("Todo title must be 1–180 characters and cannot contain brackets or line breaks");
  }
  return title;
}

function todoLine(prefix, title, docPath) {
  return `${prefix}[${title}](${docPath})`;
}

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "todo";
}

async function projectRootPath(projectRoot) {
  const root = path.resolve(projectRoot);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Invalid project root: ${root}`);
  const gitRoot = (await runGit(root, ["rev-parse", "--show-toplevel"])).trim();
  return gitRoot;
}

async function githubBaseFor(root) {
  try {
    const remote = (await runGit(root, ["config", "--get", "remote.origin.url"])).trim();
    const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
    return match ? `https://github.com/${match[1]}/blob/HEAD` : "";
  } catch {
    return "";
  }
}

async function hasStagedChanges(root) {
  try {
    await runGit(root, ["diff", "--cached", "--quiet"]);
    return false;
  } catch (error) {
    if (error?.exitCode === 1) return true;
    throw error;
  }
}

async function todoPushTarget(root) {
  const upstream = await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => "");
  const [remote, ...branchParts] = upstream.split("/");
  const branch = branchParts.join("/");
  if (!remote || !branch) throw new Error("Todo push needs a tracking branch");
  await runGit(root, ["fetch", remote, branch], 60_000);
  return { upstream, remote, branch };
}

async function unpushedTodoCommits(root, upstream) {
  const patchStates = new Map((await runGit(root, ["cherry", upstream, "HEAD"])).split(/\r?\n/).filter(Boolean).map((line) => {
    const [state, hash] = line.split(/\s+/, 2);
    return [hash, state];
  }));
  const output = await runGit(root, ["log", "--reverse", "--format=%H%x1f%s", `${upstream}..HEAD`]);
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, subject] = line.split("\u001f");
    return { hash, subject };
  }).filter((commit) => patchStates.get(commit.hash) === "+" && isTodoCommitSubject(commit.subject));
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function runGit(root, args, timeout = 20_000) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    });
    return stdout;
  } catch (error) {
    const message = (error?.stderr || error?.message || "Git command failed").trim();
    const wrapped = new Error(message);
    wrapped.exitCode = error?.code;
    throw wrapped;
  }
}
