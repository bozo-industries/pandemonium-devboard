const DEFAULT_PROJECT_ROOT = "C:\\Users\\user\\Code\\Pandemonium";
const DASHBOARD_TAGLINE = "Automate modern survival. Protect modern living. For time, and all time.";
const DEFAULT_SSH = {
  host: "",
  identityFile: "",
  projectRoot: "",
  liveEnvRoot: "",
  rootEnvPath: "",
  sudo: false
};
const TARGET_MODE_STORAGE_KEY = "local-dev-dashboard:environment-target-mode";
const PROJECT_TIME_ZONE = "Europe/Berlin";

const state = {
  targetMode: storedTargetMode(),
  projectRoot: DEFAULT_PROJECT_ROOT,
  ssh: { ...DEFAULT_SSH },
  scan: null,
  activeTab: "overview",
  overview: null,
  overviewRequest: 0,
  todoBoard: null,
  selectedTodoId: "",
  creatingTodo: false,
  selectedCommit: "",
  selectedDiffPath: "",
  selectedId: "",
  drafts: new Map(),
  dirty: false
};

const els = {
  projectForm: document.querySelector("#projectForm"),
  shell: document.querySelector(".shell"),
  topbar: document.querySelector(".topbar"),
  localTarget: document.querySelector("#localTarget"),
  projectRoot: document.querySelector("#projectRoot"),
  projectSummary: document.querySelector("#projectSummary"),
  targetMode: [...document.querySelectorAll("input[name='targetMode']")],
  sshPanel: document.querySelector("#sshPanel"),
  sshHost: document.querySelector("#sshHost"),
  sshIdentityFile: document.querySelector("#sshIdentityFile"),
  sshProjectRoot: document.querySelector("#sshProjectRoot"),
  sshLiveEnvRoot: document.querySelector("#sshLiveEnvRoot"),
  sshRootEnvPath: document.querySelector("#sshRootEnvPath"),
  sshSudo: document.querySelector("#sshSudo"),
  detectSshButton: document.querySelector("#detectSshButton"),
  reloadButton: document.querySelector("#reloadButton"),
  fileList: document.querySelector("#fileList"),
  fileCount: document.querySelector("#fileCount"),
  fileTitle: document.querySelector("#fileTitle"),
  fileMeta: document.querySelector("#fileMeta"),
  statusLine: document.querySelector("#statusLine"),
  rows: document.querySelector("#rows"),
  emptyState: document.querySelector("#emptyState"),
  showUnderlay: document.querySelector("#showUnderlay"),
  showDocs: document.querySelector("#showDocs"),
  revealValues: document.querySelector("#revealValues"),
  addRowButton: document.querySelector("#addRowButton"),
  saveButton: document.querySelector("#saveButton"),
  docsPanel: document.querySelector("#docsPanel"),
  docsText: document.querySelector("#docsText"),
  overviewTab: document.querySelector("#overviewTab"),
  environmentTab: document.querySelector("#environmentTab"),
  todoTab: document.querySelector("#todoTab"),
  overviewPanel: document.querySelector("#overviewPanel"),
  environmentPanel: document.querySelector("#environmentPanel"),
  todoPanel: document.querySelector("#todoPanel"),
  refreshButton: document.querySelector("#refreshButton"),
  locTotal: document.querySelector("#locTotal"),
  locFiles: document.querySelector("#locFiles"),
  locFilesSplit: document.querySelector("#locFilesSplit"),
  locSplit: document.querySelector("#locSplit"),
  locScope: document.querySelector("#locScope"),
  locError: document.querySelector("#locError"),
  locBreakdown: document.querySelector("#locBreakdown"),
  locCard: document.querySelector(".loc-card"),
  tokenTotal: document.querySelector("#tokenTotal"),
  tokenCost: document.querySelector("#tokenCost"),
  tokenSplit: document.querySelector("#tokenSplit"),
  tokenError: document.querySelector("#tokenError"),
  tokenBreakdown: document.querySelector("#tokenBreakdown"),
  tokenDaily: document.querySelector("#tokenDaily"),
  usageCard: document.querySelector(".usage-card"),
  gitBranch: document.querySelector("#gitBranch"),
  gitPushButton: document.querySelector("#gitPushButton"),
  gitError: document.querySelector("#gitError"),
  commitList: document.querySelector("#commitList"),
  commitViewer: document.querySelector("#commitViewer"),
  commitEmpty: document.querySelector("#commitEmpty"),
  commitDetails: document.querySelector("#commitDetails"),
  commitSubject: document.querySelector("#commitSubject"),
  commitMeta: document.querySelector("#commitMeta"),
  commitHash: document.querySelector("#commitHash"),
  commitBody: document.querySelector("#commitBody"),
  changedFiles: document.querySelector("#changedFiles"),
  diffTitle: document.querySelector("#diffTitle"),
  diffStatus: document.querySelector("#diffStatus"),
  diffViewer: document.querySelector("#diffViewer"),
  todoStatus: document.querySelector("#todoStatus"),
  todoList: document.querySelector("#todoList"),
  todoEmpty: document.querySelector("#todoEmpty"),
  todoEditorContent: document.querySelector("#todoEditorContent"),
  todoTitle: document.querySelector("#todoTitle"),
  todoDocLink: document.querySelector("#todoDocLink"),
  todoDocument: document.querySelector("#todoDocument"),
  todoNewButton: document.querySelector("#todoNewButton"),
  todoSaveButton: document.querySelector("#todoSaveButton"),
  todoRemoveButton: document.querySelector("#todoRemoveButton"),
  todoPushButton: document.querySelector("#todoPushButton")
};

els.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  syncTargetFromForm();
  scan();
});
els.overviewTab.addEventListener("click", () => selectTab("overview"));
els.environmentTab.addEventListener("click", () => selectTab("environment"));
els.todoTab.addEventListener("click", () => selectTab("todo"));
els.reloadButton.addEventListener("click", () => scan());
els.detectSshButton.addEventListener("click", detectSsh);
for (const input of els.targetMode) {
  input.addEventListener("change", () => {
    syncTargetFromForm();
    persistTargetMode();
    renderTargetMode();
  });
}
els.showUnderlay.addEventListener("change", renderSelectedFile);
els.showDocs.addEventListener("change", renderSelectedFile);
els.revealValues.addEventListener("change", renderSelectedFile);
els.addRowButton.addEventListener("click", addEnvRow);
els.saveButton.addEventListener("click", saveSelectedFile);
els.todoSaveButton.addEventListener("click", saveTodoPlan);
els.todoNewButton.addEventListener("click", createTodo);
els.todoRemoveButton.addEventListener("click", removeTodo);
els.todoPushButton.addEventListener("click", pushTodoPlans);
els.gitPushButton.addEventListener("click", pushHead);
new ResizeObserver(scheduleUsageCardHeight).observe(els.locCard);
for (const input of [els.sshHost, els.sshIdentityFile, els.sshProjectRoot, els.sshLiveEnvRoot, els.sshRootEnvPath]) {
  input.addEventListener("input", queueSshTargetSave);
}
els.sshSudo.addEventListener("change", queueSshTargetSave);
window.addEventListener("hashchange", () => {
  const tab = tabFromHash();
  if (tab !== state.activeTab) selectTab(tab, false);
});

renderTargetMode();
loadDefaults();

async function loadDefaults() {
  try {
    const defaults = await api("/api/defaults", {});
    state.projectRoot = defaults.projectRoot || DEFAULT_PROJECT_ROOT;
    state.ssh = { ...DEFAULT_SSH, ...(defaults.ssh || {}) };
  } catch {
    state.projectRoot = DEFAULT_PROJECT_ROOT;
    state.ssh = { ...DEFAULT_SSH };
  }
  writeTargetToForm();
  selectTab(tabFromHash(), false);
}

function selectTab(tab, updateHash = true) {
  tab = ["overview", "environment", "todo"].includes(tab) ? tab : "overview";
  if (updateHash && location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  state.activeTab = tab;
  const overview = tab === "overview";
  const todo = tab === "todo";
  els.overviewTab.classList.toggle("active", overview);
  els.environmentTab.classList.toggle("active", !overview && !todo);
  els.todoTab.classList.toggle("active", todo);
  els.overviewTab.setAttribute("aria-selected", String(overview));
  els.environmentTab.setAttribute("aria-selected", String(!overview && !todo));
  els.todoTab.setAttribute("aria-selected", String(todo));
  els.overviewPanel.hidden = !overview;
  els.environmentPanel.hidden = overview || todo;
  els.todoPanel.hidden = !todo;
  document.body.classList.toggle("overview-active", overview);
  if (overview) {
    if (!state.overview || state.overview.projectRoot !== DEFAULT_PROJECT_ROOT) loadOverview();
    else renderOverview();
  } else if (todo) {
    loadTodos();
  } else if (!state.scan) {
    scan();
  }
}

function tabFromHash() {
  const tab = location.hash.slice(1).toLowerCase();
  return ["overview", "environment", "todo"].includes(tab) ? tab : "overview";
}

async function loadTodos() {
  els.todoStatus.textContent = "Loading README TODOs…";
  els.todoStatus.className = "overview-status loading";
  try {
    state.todoBoard = await api("/api/todos", { projectRoot: DEFAULT_PROJECT_ROOT });
    if (!state.creatingTodo && (!state.selectedTodoId || !state.todoBoard.todos.some((todo) => todo.id === state.selectedTodoId))) {
      state.selectedTodoId = state.todoBoard.todos[0]?.id || "";
    }
    renderTodos();
    els.todoStatus.textContent = `${state.todoBoard.todos.length} TODO${state.todoBoard.todos.length === 1 ? "" : "s"} from README.md`;
    els.todoStatus.className = "overview-status ok";
  } catch (error) {
    state.todoBoard = null;
    state.selectedTodoId = "";
    renderTodos();
    els.todoStatus.textContent = error.message;
    els.todoStatus.className = "overview-status error";
  }
}

function renderTodos() {
  const todos = state.todoBoard?.todos || [];
  els.todoList.textContent = "";
  for (const todo of todos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `todo-item${todo.id === state.selectedTodoId ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = todo.title;
    const meta = document.createElement("small");
    meta.textContent = todoHistorySummary(todo.history);
    button.append(title, meta);
    button.addEventListener("click", () => {
      state.creatingTodo = false;
      state.selectedTodoId = todo.id;
      renderTodos();
    });
    els.todoList.append(button);
  }
  const selected = todos.find((todo) => todo.id === state.selectedTodoId);
  const editing = Boolean(selected || state.creatingTodo);
  els.todoNewButton.disabled = !state.todoBoard;
  els.todoEmpty.hidden = editing;
  els.todoEditorContent.hidden = !editing;
  els.todoSaveButton.disabled = !editing;
  els.todoRemoveButton.disabled = !selected;
  els.todoPushButton.disabled = !state.todoBoard;
  if (!editing) return;
  els.todoTitle.value = selected?.title || "";
  els.todoDocLink.hidden = !selected?.githubUrl;
  els.todoDocLink.href = selected?.githubUrl || "#";
  els.todoDocLink.textContent = selected?.docPath || "";
  els.todoDocument.value = selected?.content || defaultTodoPlan(selected?.title || "New Todo");
}

function todoHistorySummary(history) {
  if (!history) return "Not committed yet";
  return `created: ${history.created.shortHash} · last edited: ${history.lastEdited.shortHash} (${formatShortDate(history.lastEdited.date)})`;
}

function createTodo() {
  state.creatingTodo = true;
  state.selectedTodoId = "";
  renderTodos();
  els.todoTitle.focus();
}

async function removeTodo() {
  const selected = state.todoBoard?.todos.find((todo) => todo.id === state.selectedTodoId);
  if (!selected) return;
  const detail = selected.docPath ? " and its detailed plan" : "";
  if (!confirm(`Remove “${selected.title}” from README.md${detail}?`)) return;
  els.todoRemoveButton.disabled = true;
  els.todoStatus.textContent = "Removing Todo…";
  els.todoStatus.className = "overview-status loading";
  try {
    state.todoBoard = await api("/api/todos/delete", {
      projectRoot: DEFAULT_PROJECT_ROOT,
      todoId: selected.id
    });
    state.selectedTodoId = state.todoBoard.todos[0]?.id || "";
    renderTodos();
    els.todoStatus.textContent = selected.docPath ? "Removed Todo and detailed plan locally" : "Removed Todo locally";
    els.todoStatus.className = "overview-status ok";
  } catch (error) {
    els.todoStatus.textContent = error.message;
    els.todoStatus.className = "overview-status error";
  } finally {
    els.todoRemoveButton.disabled = !state.selectedTodoId;
  }
}

async function saveTodoPlan() {
  const selected = state.todoBoard?.todos.find((todo) => todo.id === state.selectedTodoId);
  if (!selected && !state.creatingTodo) return;
  els.todoSaveButton.disabled = true;
  els.todoStatus.textContent = "Saving Todo plan…";
  els.todoStatus.className = "overview-status loading";
  try {
    state.todoBoard = await api("/api/todos/save", {
      projectRoot: DEFAULT_PROJECT_ROOT,
      todoId: selected?.id || "",
      title: els.todoTitle.value,
      content: els.todoDocument.value
    });
    const title = els.todoTitle.value.trim();
    state.creatingTodo = false;
    state.selectedTodoId = state.todoBoard.todos.find((todo) => todo.title === title)?.id || state.todoBoard.todos[0]?.id || "";
    renderTodos();
    els.todoStatus.textContent = "Saved README link and Todo plan locally";
    els.todoStatus.className = "overview-status ok";
  } catch (error) {
    els.todoStatus.textContent = error.message;
    els.todoStatus.className = "overview-status error";
  } finally {
    els.todoSaveButton.disabled = false;
  }
}

async function pushTodoPlans() {
  if (!confirm("Commit and push README.md plus docs/todo changes?")) return;
  els.todoPushButton.disabled = true;
  els.todoStatus.textContent = "Committing and pushing Todo plans…";
  els.todoStatus.className = "overview-status loading";
  try {
    const result = await api("/api/todos/push", { projectRoot: DEFAULT_PROJECT_ROOT });
    els.todoStatus.textContent = `Pushed Todo plans in ${result.commit}`;
    els.todoStatus.className = "overview-status ok";
  } catch (error) {
    els.todoStatus.textContent = error.message;
    els.todoStatus.className = "overview-status error";
  } finally {
    els.todoPushButton.disabled = false;
  }
}

async function loadOverview() {
  const request = ++state.overviewRequest;
  state.overview = {
    projectRoot: DEFAULT_PROJECT_ROOT,
    loc: { pending: true },
    tokens: { pending: true },
    git: { pending: true }
  };
  renderOverview();
  const requests = [
    loadOverviewPart(request, "loc", "/api/overview/loc", { projectRoot: DEFAULT_PROJECT_ROOT }, renderLoc),
    loadOverviewPart(request, "tokens", "/api/overview/tokens", {}, renderTokens),
    loadOverviewPart(request, "git", "/api/overview/git", { projectRoot: DEFAULT_PROJECT_ROOT, commitLimit: 30 }, renderGit)
  ];
  await Promise.all(requests);
}

async function loadOverviewPart(request, key, path, body, render) {
  try {
    const data = await api(path, body);
    if (request !== state.overviewRequest) return;
    state.overview[key] = { ok: true, data };
  } catch (error) {
    if (request !== state.overviewRequest) return;
    state.overview[key] = { ok: false, error: error.message };
  }
  render(state.overview[key]);
}

function renderOverview() {
  const response = state.overview;
  els.projectSummary.textContent = DASHBOARD_TAGLINE;
  renderLoc(response.loc);
  renderTokens(response.tokens);
  renderGit(response.git);
}

function renderLoc(result) {
  const pending = result?.pending;
  els.locError.hidden = pending || result.ok;
  els.locError.textContent = pending || result.ok ? "" : result.error;
  els.locBreakdown.textContent = "";
  if (pending || !result.ok) {
    els.locTotal.textContent = "—";
    els.locFiles.textContent = "—";
    els.locSplit.textContent = pending ? "Loading production lines" : "LOC unavailable";
    els.locFilesSplit.textContent = pending ? "Loading source files" : "File counts unavailable";
    return;
  }
  const data = result.data;
  els.locTotal.textContent = formatNumber(data.totals.code);
  els.locFiles.textContent = formatNumber(data.totals.codeFiles);
  els.locFilesSplit.textContent = `${formatNumber(data.totals.files)} total − ${formatNumber(data.totals.testFiles)} test files`;
  els.locSplit.textContent = `${formatNumber(data.totals.lines)} total − ${formatNumber(data.totals.tests)} tests (${data.testPercent}%)`;
  els.locScope.textContent = data.scope;
  const moduleNames = new Set(data.modules.map((module) => module.name));
  const nodes = data.tree?.children || [];
  const moduleNodes = nodes.filter((node) => moduleNames.has(node.name));
  renderLocSection("Daemon + runtime", nodes.filter((node) => !moduleNames.has(node.name)));
  renderLocSection("Modules", [locTreeGroup("modules", moduleNodes)]);
  scheduleUsageCardHeight();
}

function scheduleUsageCardHeight() {
  requestAnimationFrame(() => {
    const height = Math.ceil(els.locCard.getBoundingClientRect().height);
    if (height > 0) els.usageCard.style.height = `${height}px`;
  });
}

function renderLocSection(title, nodes) {
  if (!nodes.length) return;
  const section = document.createElement("section");
  section.className = "loc-tree-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const tree = document.createElement("div");
  tree.className = "loc-tree";
  section.append(heading, tree);
  els.locBreakdown.append(section);
  renderLocTree(nodes, 0, tree);
}

function renderLocTree(nodes, depth = 0, container) {
  for (const node of nodes) {
    const hasChildren = node.children?.length > 0;
    const branch = hasChildren ? document.createElement("details") : document.createElement("div");
    branch.className = hasChildren ? "loc-tree-branch" : "loc-tree-leaf";
    if (hasChildren) branch.open = true;

    const row = hasChildren ? document.createElement("summary") : document.createElement("div");
    row.className = "loc-tree-row";
    row.dataset.depth = String(depth);

    const name = document.createElement("span");
    name.className = "loc-tree-name";
    const marker = document.createElement("span");
    marker.className = `loc-tree-marker ${hasChildren ? "folder" : "file"}`;
    const label = document.createElement("span");
    label.textContent = hasChildren ? `${node.name}/` : node.name;
    name.append(marker, label);

    const stats = document.createElement("span");
    stats.className = "loc-tree-stats";
    stats.append(
      locTreeStat("code", node.code),
      locTreeStat("tests", node.tests),
      locTreeStat("files", node.files)
    );

    row.append(name, stats);
    branch.append(row);
    container.append(branch);

    if (hasChildren) {
      const children = document.createElement("div");
      children.className = "loc-tree-children";
      branch.append(children);
      renderLocTree(node.children, depth + 1, children);
    }
  }
}

function locTreeStat(name, value) {
  const stat = document.createElement("span");
  stat.className = `loc-tree-stat ${name}`;
  const label = document.createElement("small");
  label.textContent = name;
  const amount = document.createElement("strong");
  amount.textContent = formatNumber(value);
  stat.append(label, amount);
  return stat;
}

function locTreeGroup(name, children) {
  return children.reduce((group, child) => ({
    ...group,
    files: group.files + child.files,
    codeFiles: group.codeFiles + child.codeFiles,
    testFiles: group.testFiles + child.testFiles,
    code: group.code + child.code,
    tests: group.tests + child.tests,
    lines: group.lines + child.lines
  }), {
    name,
    files: 0,
    codeFiles: 0,
    testFiles: 0,
    code: 0,
    tests: 0,
    lines: 0,
    children
  });
}

function renderTokens(result) {
  const pending = result?.pending;
  els.tokenError.hidden = pending || result.ok;
  els.tokenError.textContent = pending || result.ok ? "" : result.error;
  els.tokenBreakdown.textContent = "";
  els.tokenDaily.textContent = "";
  if (pending || !result.ok) {
    els.tokenTotal.textContent = "—";
    els.tokenCost.textContent = "—";
    els.tokenSplit.textContent = pending ? "Loading Codex usage" : "Usage unavailable";
    return;
  }
  const { totals, daily } = result.data;
  els.tokenTotal.textContent = compactNumber(totals.totalTokens);
  els.tokenCost.textContent = formatCost(totals.costUSD);
  els.tokenSplit.textContent = `${compactNumber(totals.inputTokens)} input · ${compactNumber(totals.outputTokens)} output · ${compactNumber(totals.cacheReadTokens)} cache`;
  const items = [
    ["Input", totals.inputTokens], ["Output", totals.outputTokens],
    ["Reasoning", totals.reasoningTokens], ["Cache read", totals.cacheReadTokens]
  ];
  for (const [label, value] of items) {
    const item = document.createElement("div");
    item.innerHTML = `<span></span><strong></strong>`;
    item.querySelector("span").textContent = label;
    item.querySelector("strong").textContent = formatNumber(value);
    els.tokenBreakdown.append(item);
  }
  if (daily.length) {
    const title = document.createElement("div");
    title.className = "daily-title";
    for (const label of ["Recent days", "Input", "Output", "Cache", "Price"]) {
      const cell = document.createElement("span");
      cell.textContent = label;
      title.append(cell);
    }
    els.tokenDaily.append(title);
    for (const day of daily) {
      const item = document.createElement("div");
      item.className = "daily-row";
      for (const value of [
        day.date,
        compactNumber(day.inputTokens),
        compactNumber(day.outputTokens),
        compactNumber(day.cacheReadTokens),
        formatCost(day.costUSD)
      ]) {
        const cell = document.createElement("span");
        cell.textContent = value;
        item.append(cell);
      }
      els.tokenDaily.append(item);
    }
  }
}

function renderGit(result) {
  const pending = result?.pending;
  els.gitError.hidden = pending || result.ok;
  els.gitError.textContent = pending || result.ok ? "" : result.error;
  els.commitList.textContent = "";
  els.gitBranch.textContent = pending ? "Loading…" : result.ok ? result.data.branch : "Unavailable";
  els.gitPushButton.hidden = pending || !result.ok || !result.data.commits.some((commit) => !commit.pushed);
  if (pending) {
    els.commitList.textContent = "Loading commits…";
    return;
  }
  if (!result.ok) return;
  for (const commit of result.data.commits) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `commit-item${commit.hash === state.selectedCommit ? " active" : ""}`;
    button.innerHTML = `<span class="commit-dot"></span><span class="commit-copy"><strong></strong><small></small><span class="commit-push-state" hidden>Not pushed</span></span><span class="commit-stats"><span class="additions"></span><span class="deletions"></span></span><code></code>`;
    button.querySelector("strong").textContent = commit.subject;
    button.querySelector("small").textContent = `${commit.author} · ${relativeDate(commit.date)}`;
    button.querySelector(".commit-push-state").hidden = commit.pushed;
    button.querySelector(".additions").textContent = `+${formatNumber(commit.additions)}`;
    button.querySelector(".deletions").textContent = `−${formatNumber(commit.deletions)}`;
    button.querySelector("code").textContent = commit.shortHash;
    button.addEventListener("click", () => loadCommit(commit.hash));
    els.commitList.append(button);
  }
  if (!result.data.commits.length) {
    els.commitList.textContent = "No commits found.";
  } else if (!state.selectedCommit) {
    loadCommit(result.data.commits[0].hash);
  }
}

async function loadCommit(commit) {
  state.selectedCommit = commit;
  state.selectedDiffPath = "";
  els.commitEmpty.hidden = true;
  els.commitDetails.hidden = false;
  els.commitSubject.textContent = "Loading commit…";
  els.commitMeta.textContent = "";
  els.changedFiles.textContent = "";
  els.diffViewer.textContent = "Choose a changed file to view its patch.";
  renderGit(state.overview.git);
  try {
    const details = await api("/api/git/commit", { projectRoot: DEFAULT_PROJECT_ROOT, commit });
    els.commitSubject.textContent = details.subject;
    els.commitMeta.textContent = `${details.author} <${details.email}> · ${formatDate(details.date)}`;
    els.commitHash.textContent = details.shortHash;
    els.commitBody.textContent = details.body;
    els.commitBody.hidden = !details.body;
    for (const file of details.files) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "changed-file";
      const status = document.createElement("span");
      status.className = `change-status status-${file.status[0].toLowerCase()}`;
      status.textContent = file.status;
      const fileName = document.createElement("code");
      fileName.textContent = file.path;
      button.append(status, fileName);
      button.addEventListener("click", () => loadDiff(commit, file.path, button));
      els.changedFiles.append(button);
    }
    if (details.files[0]) loadDiff(commit, details.files[0].path, els.changedFiles.firstElementChild);
  } catch (error) {
    els.commitSubject.textContent = "Could not load commit";
    els.commitMeta.textContent = error.message;
  }
}

async function pushHead() {
  if (!confirm("Push the entire current branch (HEAD), including all local commits, to origin?")) return;
  els.gitPushButton.disabled = true;
  els.gitPushButton.textContent = "Pushing…";
  try {
    await api("/api/git/push", { projectRoot: DEFAULT_PROJECT_ROOT });
    await loadOverview();
    if (state.selectedCommit) await loadCommit(state.selectedCommit);
  } catch (error) {
    els.gitError.hidden = false;
    els.gitError.textContent = error.message;
  } finally {
    els.gitPushButton.disabled = false;
    els.gitPushButton.textContent = "Push HEAD";
  }
}

async function loadDiff(commit, filePath, button) {
  state.selectedDiffPath = filePath;
  for (const item of els.changedFiles.children) item.classList.toggle("active", item === button);
  els.diffTitle.textContent = filePath;
  els.diffStatus.textContent = "Loading patch…";
  els.diffViewer.textContent = "";
  try {
    const result = await api("/api/git/diff", { projectRoot: DEFAULT_PROJECT_ROOT, commit, path: filePath });
    if (state.selectedCommit !== commit || state.selectedDiffPath !== filePath) return;
    els.diffViewer.textContent = result.patch || "No textual patch for this file.";
    els.diffStatus.textContent = result.truncated ? "Output truncated" : "";
  } catch (error) {
    els.diffViewer.textContent = error.message;
    els.diffStatus.textContent = "Could not load patch";
  }
}

async function scan() {
  syncTargetFromForm();
  setStatus(`Scanning ${state.targetMode === "ssh" ? "remote" : "local"} env files...`);
  state.drafts.clear();
  state.dirty = false;
  try {
    const response = await api("/api/scan", scanPayload());
    state.scan = response;
    if (state.targetMode === "local") {
      state.projectRoot = response.projectRoot;
      els.projectRoot.value = response.projectRoot;
    }
    state.selectedId = response.files[0]?.id ?? "";
    render();
    setStatus(`Loaded ${response.files.length} env files from ${targetLabel()}`, "ok");
  } catch (error) {
    state.scan = null;
    state.selectedId = "";
    render();
    setStatus(error.message, "error");
  }
}

async function detectSsh() {
  syncTargetFromForm();
  setStatus("Detecting remote folders from systemd...");
  els.detectSshButton.disabled = true;
  try {
    const detected = await api("/api/detect-ssh", { ssh: state.ssh });
    state.ssh = {
      host: detected.host || state.ssh.host,
      identityFile: detected.identityFile || state.ssh.identityFile,
      projectRoot: detected.projectRoot || state.ssh.projectRoot,
      liveEnvRoot: detected.liveEnvRoot || state.ssh.liveEnvRoot,
      rootEnvPath: detected.rootEnvPath || state.ssh.rootEnvPath,
      sudo: Boolean(detected.sudo)
    };
    writeTargetToForm();
    await saveSshTarget();
    setStatus(`Detected checkout ${state.ssh.projectRoot} and live env ${state.ssh.liveEnvRoot}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.detectSshButton.disabled = false;
  }
}

async function saveSelectedFile() {
  const file = selectedFile();
  if (!file) return;

  const draft = state.drafts.get(file.id);
  if (!draft) {
    setStatus("No local edits to save.");
    return;
  }

  const changedValues = {};
  for (const row of visibleRows(file)) {
    const nextValue = draft.values.get(row.key);
    if (nextValue !== undefined && nextValue !== row.actualValue) {
      changedValues[row.key] = nextValue;
    }
  }
  const deleteKeys = [...draft.deleted].filter((key) => file.rows.some((row) => row.key === key && row.hasActual));

  if (Object.keys(changedValues).length === 0 && deleteKeys.length === 0) {
    setStatus("No local edits to save.");
    return;
  }

  const changeCount = Object.keys(changedValues).length + deleteKeys.length;
  setStatus(`Saving ${changeCount} change(s) to ${file.livePath || file.envPath}...`, "dirty");
  els.saveButton.disabled = true;
  try {
    const response = await api("/api/save", {
      ...scanPayload(),
      projectRoot: state.projectRoot,
      envPath: file.envPath,
      values: changedValues,
      deleteKeys
    });
    state.scan = response;
    state.drafts.clear();
    state.dirty = false;
    render();
    setStatus(`Saved ${file.livePath || file.envPath}`, "ok");
  } catch (error) {
    render();
    setStatus(error.message, "error");
  }
}

function render() {
  els.projectSummary.textContent = DASHBOARD_TAGLINE;
  els.fileCount.textContent = state.scan ? `${state.scan.files.length} files` : "No scan";
  renderFileList();
  renderSelectedFile();
}

function renderFileList() {
  els.fileList.textContent = "";
  const files = state.scan?.files ?? [];
  const groups = groupBy(files, (file) => file.group);
  for (const [group, groupFiles] of groups) {
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = group;
    els.fileList.append(title);

    for (const file of groupFiles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-button${file.id === state.selectedId ? " active" : ""}`;
      button.innerHTML = `
        <span class="file-path"></span>
        <span class="file-stats">
          <span class="mini-pill set"></span>
          <span class="mini-pill empty"></span>
          <span class="mini-pill missing"></span>
        </span>
      `;
      button.querySelector(".file-path").textContent = file.envPath;
      button.querySelector(".mini-pill.set").textContent = `${file.stats.set} set`;
      button.querySelector(".mini-pill.empty").textContent = `${file.stats.empty} empty`;
      button.querySelector(".mini-pill.missing").textContent = `${file.stats.missing} missing`;
      button.addEventListener("click", () => {
        state.selectedId = file.id;
        render();
      });
      els.fileList.append(button);
    }
  }
}

function renderSelectedFile() {
  const file = selectedFile();
  els.docsPanel.hidden = !els.showDocs.checked;

  if (!file) {
    els.fileTitle.textContent = "Select a file";
    els.fileMeta.textContent = "";
    els.rows.hidden = true;
    els.emptyState.hidden = false;
    els.docsText.textContent = "";
    els.addRowButton.disabled = true;
    els.saveButton.disabled = true;
    els.saveButton.textContent = "Save";
    return;
  }

  els.fileTitle.textContent = file.owner;
  els.fileMeta.textContent = `${file.livePath ? `${file.livePath} as ` : ""}${file.envPath}${file.examplePath ? ` underlay ${file.examplePath}` : ""}`;
  renderDocsMarkdown(file.docs || "No configuration docs section found for this file.");
  els.emptyState.hidden = true;
  els.rows.hidden = false;
  els.rows.textContent = "";
  els.addRowButton.disabled = false;

  const draft = draftFor(file);
  const showUnderlay = els.showUnderlay.checked;
  const reveal = els.revealValues.checked;

  for (const row of visibleRows(file)) {
    const wrapper = document.createElement("div");
    wrapper.className = `env-row${showUnderlay ? "" : " no-underlay"}`;

    const keyCell = document.createElement("div");
    const key = document.createElement("div");
    key.className = "key";
    const keyName = document.createElement("span");
    keyName.textContent = row.key;
    key.append(keyName);
    keyCell.append(key);
    const hintText = [row.comments.join(" "), els.showDocs.checked ? row.docs : ""].filter(Boolean).join(" ");
    if (hintText) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = hintText;
      keyCell.append(hint);
    }

    const valueCell = document.createElement("div");
    valueCell.className = "value-wrap";
    const input = document.createElement("textarea");
    input.rows = 1;
    input.spellcheck = false;
    input.value = rowValue(row, draft);
    input.placeholder = showUnderlay && row.exampleValue ? row.exampleValue : "";
    input.dataset.key = row.key;
    input.style.webkitTextSecurity = !reveal && input.value ? "disc" : "";
    if (draft.values.has(row.key) && draft.values.get(row.key) !== row.actualValue) {
      input.classList.add("changed");
    }
    input.addEventListener("input", () => {
      draft.values.set(row.key, input.value);
      updateDirtyState(file);
      input.classList.toggle("changed", input.value !== row.actualValue);
      autosizeTextarea(input);
    });
    valueCell.append(input);
    autosizeTextarea(input);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "row-delete";
    deleteButton.textContent = "x";
    deleteButton.title = `Delete ${row.key}`;
    deleteButton.setAttribute("aria-label", `Delete ${row.key}`);
    deleteButton.addEventListener("click", () => deleteEnvRow(file, row.key));

    const status = document.createElement("span");
    status.className = `status-pill status-${row.status}`;
    status.textContent = statusGlyph(row.status);
    status.title = row.status;
    status.setAttribute("aria-label", row.status);

    const rowActions = document.createElement("div");
    rowActions.className = "row-actions";
    rowActions.append(deleteButton, status);

    wrapper.append(keyCell, valueCell);
    if (showUnderlay) {
      const underlay = document.createElement("div");
      underlay.className = "underlay";
      underlay.textContent = row.hasExample ? row.exampleValue || "(empty example)" : "No example";
      wrapper.append(underlay);
    }
    wrapper.append(rowActions);
    els.rows.append(wrapper);
  }

  updateDirtyState(file);
}

function renderDocsMarkdown(markdown) {
  const lines = String(markdown || "").replaceAll("\r", "").split("\n");
  const content = document.createDocumentFragment();

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(heading[1].length === 1 ? "h3" : "h4");
      appendMarkdownInline(element, heading[2]);
      content.append(element);
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const block = document.createElement("pre");
      block.textContent = codeLines.join("\n");
      content.append(block);
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const cell of markdownTableCells(lines[index])) {
        const element = document.createElement("th");
        appendMarkdownInline(element, cell);
        headRow.append(element);
      }
      head.append(headRow);
      table.append(head);
      index += 2;
      const body = document.createElement("tbody");
      while (index < lines.length && lines[index].includes("|")) {
        const row = document.createElement("tr");
        for (const cell of markdownTableCells(lines[index])) {
          const element = document.createElement("td");
          appendMarkdownInline(element, cell);
          row.append(element);
        }
        body.append(row);
        index += 1;
      }
      table.append(body);
      content.append(table);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        appendMarkdownInline(item, lines[index].replace(/^[-*]\s+/, ""));
        list.append(item);
        index += 1;
      }
      content.append(list);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) &&
      !lines[index].startsWith("```") && !/^[-*]\s+/.test(lines[index]) && !isMarkdownTable(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendMarkdownInline(paragraph, paragraphLines.join(" "));
    content.append(paragraph);
  }

  els.docsText.replaceChildren(content);
}

function isMarkdownTable(lines, index) {
  return Boolean(lines[index]?.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || ""));
}

function markdownTableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function appendMarkdownInline(element, text) {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) element.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[1];
      element.append(code);
    } else {
      const link = document.createElement("a");
      link.href = match[3];
      link.textContent = match[2];
      link.target = "_blank";
      link.rel = "noreferrer";
      element.append(link);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) element.append(document.createTextNode(text.slice(cursor)));
}

function statusGlyph(status) {
  if (status === "set") return "✓";
  if (status === "empty") return "?";
  if (status === "missing") return "!";
  if (status === "new") return "?";
  return "!";
}

function updateDirtyState(file) {
  const draft = draftFor(file);
  const dirtyCount = visibleRows(file).filter((row) => draft.values.has(row.key) && draft.values.get(row.key) !== row.actualValue).length + draft.deleted.size;
  state.dirty = dirtyCount > 0;
  els.saveButton.disabled = !state.dirty;
  els.saveButton.textContent = state.dirty ? `Save ${dirtyCount}` : "Save";
  els.addRowButton.disabled = !file;
  if (state.dirty) {
    setStatus(`${dirtyCount} unsaved ${dirtyCount === 1 ? "edit" : "edits"}`, "dirty");
  } else if (!els.statusLine.classList.contains("error")) {
    setStatus(`Loaded ${file.livePath || file.envPath}`);
  }
}

function draftFor(file) {
  if (!state.drafts.has(file.id)) {
    state.drafts.set(file.id, {
      values: new Map(file.rows.map((row) => [row.key, row.actualValue])),
      deleted: new Set()
    });
  }
  return state.drafts.get(file.id);
}

function rowValue(row, draft) {
  return draft.values.has(row.key) ? draft.values.get(row.key) : row.actualValue;
}

function autosizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function visibleRows(file) {
  const draft = draftFor(file);
  return file.rows.filter((row) => !draft.deleted.has(row.key));
}

function addEnvRow() {
  const file = selectedFile();
  if (!file) return;
  const rawKey = prompt("New env key, for example SERVICE_EXAMPLE_FLAG");
  const key = (rawKey || "").trim();
  if (!key) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    setStatus(`Invalid env key: ${key}`, "error");
    return;
  }
  const draft = draftFor(file);
  if (file.rows.some((row) => row.key === key) && !draft.deleted.has(key)) {
    setStatus(`${key} already exists in this file.`, "error");
    return;
  }
  draft.deleted.delete(key);
  let row = file.rows.find((item) => item.key === key);
  if (!row) {
    row = {
      key,
      exampleValue: "",
      actualValue: "",
      effectiveValue: "",
      hasActual: false,
      hasExample: false,
      status: "new",
      comments: [],
      docs: ""
    };
    file.rows.push(row);
  }
  draft.values.set(key, "");
  setStatus(`Added ${key}; enter a value and save.`, "dirty");
  renderSelectedFile();
  const input = els.rows.querySelector(`textarea[data-key="${CSS.escape(key)}"]`);
  input?.focus();
}

function deleteEnvRow(file, key) {
  const draft = draftFor(file);
  const row = file.rows.find((item) => item.key === key);
  if (!row) return;
  if (!confirm(`Delete ${key} from ${file.livePath || file.envPath}?`)) {
    return;
  }
  draft.values.delete(key);
  if (row.hasActual) {
    draft.deleted.add(key);
  } else {
    file.rows = file.rows.filter((item) => item.key !== key);
    draft.deleted.delete(key);
  }
  updateDirtyState(file);
  renderSelectedFile();
  setStatus(`Deleted ${key}; save to write the file.`, "dirty");
}

function selectedFile() {
  return (state.scan?.files ?? []).find((file) => file.id === state.selectedId);
}

function setStatus(message, kind = "") {
  els.statusLine.textContent = message;
  els.statusLine.className = `status-line ${kind}`.trim();
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function syncTargetFromForm() {
  state.targetMode = document.querySelector("input[name='targetMode']:checked")?.value || "local";
  state.projectRoot = els.projectRoot.value.trim() || DEFAULT_PROJECT_ROOT;
  state.ssh = {
    host: els.sshHost.value.trim() || DEFAULT_SSH.host,
    identityFile: els.sshIdentityFile.value.trim(),
    projectRoot: els.sshProjectRoot.value.trim() || DEFAULT_SSH.projectRoot,
    liveEnvRoot: els.sshLiveEnvRoot.value.trim() || DEFAULT_SSH.liveEnvRoot,
    rootEnvPath: els.sshRootEnvPath.value.trim() || DEFAULT_SSH.rootEnvPath,
    sudo: els.sshSudo.checked
  };
}

function writeTargetToForm() {
  for (const input of els.targetMode) input.checked = input.value === state.targetMode;
  els.projectRoot.value = state.projectRoot;
  els.sshHost.value = state.ssh.host;
  els.sshIdentityFile.value = state.ssh.identityFile;
  els.sshProjectRoot.value = state.ssh.projectRoot;
  els.sshLiveEnvRoot.value = state.ssh.liveEnvRoot;
  els.sshRootEnvPath.value = state.ssh.rootEnvPath;
  els.sshSudo.checked = state.ssh.sudo;
}

function storedTargetMode() {
  try {
    return localStorage.getItem(TARGET_MODE_STORAGE_KEY) === "ssh" ? "ssh" : "local";
  } catch {
    return "local";
  }
}

function persistTargetMode() {
  try {
    localStorage.setItem(TARGET_MODE_STORAGE_KEY, state.targetMode);
  } catch {
    // Browser storage can be disabled; Environment still works for this session.
  }
}

let sshTargetSaveTimer;

function queueSshTargetSave() {
  syncTargetFromForm();
  clearTimeout(sshTargetSaveTimer);
  sshTargetSaveTimer = setTimeout(() => {
    saveSshTarget().catch((error) => setStatus(`Could not save SSH settings: ${error.message}`, "error"));
  }, 350);
}

async function saveSshTarget() {
  syncTargetFromForm();
  const result = await api("/api/settings/ssh", { ssh: state.ssh });
  state.ssh = { ...DEFAULT_SSH, ...(result.ssh || {}) };
}

function renderTargetMode() {
  const ssh = state.targetMode === "ssh";
  els.sshPanel.hidden = !ssh;
  els.detectSshButton.hidden = !ssh;
  els.localTarget.hidden = ssh;
  document.body.classList.toggle("ssh-target", ssh);
  els.overviewTab.disabled = false;
  els.todoTab.disabled = false;
  els.overviewTab.title = "Project overview";
  els.todoTab.title = "README Todo plans";
}

function scanPayload() {
  if (state.targetMode === "ssh") {
    return { targetMode: "ssh", ssh: state.ssh };
  }
  return { targetMode: "local", projectRoot: state.projectRoot };
}

function targetLabel() {
  if (state.targetMode === "ssh") {
    return `${state.ssh.host}:${state.ssh.projectRoot}`;
  }
  return state.projectRoot;
}

function scanTotals() {
  return (state.scan?.files ?? []).reduce((totals, file) => ({
    total: totals.total + file.stats.total,
    set: totals.set + file.stats.set,
    empty: totals.empty + file.stats.empty,
    missing: totals.missing + file.stats.missing
  }), { total: 0, set: 0, empty: 0, missing: 0 });
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatCost(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PROJECT_TIME_ZONE
  }).format(date);
}

function formatShortDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PROJECT_TIME_ZONE
  }).format(date);
}

function relativeDate(value) {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (!Number.isFinite(seconds)) return value;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

function defaultTodoPlan(title) {
  return `# ${title}\n\n## Goal\n\nDescribe the outcome this TODO should achieve.\n\n## Context\n\nRecord the relevant code, docs, constraints, and open questions.\n\n## Plan\n\n1. Identify the current behavior and affected boundaries.\n2. Make the smallest complete implementation change.\n3. Add or update focused tests and documentation.\n4. Verify the result in the relevant local or live surface.\n\n## Done when\n\n- [ ] The intended behavior is implemented.\n- [ ] Documentation is aligned with the current checkout.\n- [ ] Verification evidence is recorded here.\n`;
}
