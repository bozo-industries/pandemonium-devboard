const DEFAULT_PROJECT_ROOT = "C:\\Users\\user\\Code\\Pandemonium";
const DEFAULT_SSH = {
  host: "",
  identityFile: "",
  projectRoot: "",
  liveEnvRoot: "",
  rootEnvPath: "",
  sudo: false
};

const state = {
  targetMode: "local",
  projectRoot: DEFAULT_PROJECT_ROOT,
  ssh: { ...DEFAULT_SSH },
  scan: null,
  activeTab: "overview",
  overview: null,
  todoBoard: null,
  selectedTodoId: "",
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
  overviewRefreshButton: document.querySelector("#overviewRefreshButton"),
  overviewTitle: document.querySelector("#overviewTitle"),
  overviewStatus: document.querySelector("#overviewStatus"),
  locTotal: document.querySelector("#locTotal"),
  locFiles: document.querySelector("#locFiles"),
  locFilesSplit: document.querySelector("#locFilesSplit"),
  locSplit: document.querySelector("#locSplit"),
  locScope: document.querySelector("#locScope"),
  locError: document.querySelector("#locError"),
  locBreakdown: document.querySelector("#locBreakdown"),
  tokenTotal: document.querySelector("#tokenTotal"),
  tokenCost: document.querySelector("#tokenCost"),
  tokenSplit: document.querySelector("#tokenSplit"),
  tokenError: document.querySelector("#tokenError"),
  tokenBreakdown: document.querySelector("#tokenBreakdown"),
  tokenDaily: document.querySelector("#tokenDaily"),
  gitBranch: document.querySelector("#gitBranch"),
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
  todoDocPath: document.querySelector("#todoDocPath"),
  todoGitHubLink: document.querySelector("#todoGitHubLink"),
  todoDocument: document.querySelector("#todoDocument"),
  todoSaveButton: document.querySelector("#todoSaveButton"),
  todoRemoveButton: document.querySelector("#todoRemoveButton"),
  todoPushButton: document.querySelector("#todoPushButton")
};

els.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  syncTargetFromForm();
  scan();
});
els.overviewRefreshButton.addEventListener("click", loadOverview);
els.overviewTab.addEventListener("click", () => selectTab("overview"));
els.environmentTab.addEventListener("click", () => selectTab("environment"));
els.todoTab.addEventListener("click", () => selectTab("todo"));
els.reloadButton.addEventListener("click", () => scan());
els.detectSshButton.addEventListener("click", detectSsh);
for (const input of els.targetMode) {
  input.addEventListener("change", () => {
    syncTargetFromForm();
    renderTargetMode();
    if (state.targetMode === "ssh") selectTab("environment");
  });
}
els.showUnderlay.addEventListener("change", renderSelectedFile);
els.showDocs.addEventListener("change", renderSelectedFile);
els.revealValues.addEventListener("change", renderSelectedFile);
els.addRowButton.addEventListener("click", addEnvRow);
els.saveButton.addEventListener("click", saveSelectedFile);
els.todoSaveButton.addEventListener("click", saveTodoPlan);
els.todoRemoveButton.addEventListener("click", removeTodo);
els.todoPushButton.addEventListener("click", pushTodoPlans);

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
  selectTab("overview");
}

function selectTab(tab) {
  if ((tab === "overview" || tab === "todo") && state.targetMode === "ssh") tab = "environment";
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
    if (!state.overview || state.overview.projectRoot !== state.projectRoot) loadOverview();
    else renderOverview();
  } else if (todo) {
    loadTodos();
  } else if (!state.scan) {
    scan();
  }
}

async function loadTodos() {
  if (state.targetMode !== "local") return selectTab("environment");
  els.todoStatus.textContent = "Loading README TODOs…";
  els.todoStatus.className = "overview-status loading";
  try {
    state.todoBoard = await api("/api/todos", { projectRoot: state.projectRoot });
    if (!state.selectedTodoId || !state.todoBoard.todos.some((todo) => todo.id === state.selectedTodoId)) {
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
    meta.textContent = todo.docPath ? todo.docPath : "No detailed plan attached";
    button.append(title, meta);
    button.addEventListener("click", () => {
      state.selectedTodoId = todo.id;
      renderTodos();
    });
    els.todoList.append(button);
  }
  const selected = todos.find((todo) => todo.id === state.selectedTodoId);
  els.todoEmpty.hidden = Boolean(selected);
  els.todoEditorContent.hidden = !selected;
  els.todoSaveButton.disabled = !selected;
  els.todoRemoveButton.disabled = !selected;
  els.todoPushButton.disabled = !selected;
  if (!selected) return;
  els.todoTitle.textContent = selected.title;
  els.todoDocPath.textContent = selected.docPath || "Save to attach docs/todo/<todo-name>.md";
  els.todoDocument.value = selected.content || defaultTodoPlan(selected.title);
  els.todoGitHubLink.hidden = !selected.githubUrl;
  els.todoGitHubLink.href = selected.githubUrl || "#";
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
      projectRoot: state.projectRoot,
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
  if (!selected) return;
  els.todoSaveButton.disabled = true;
  els.todoStatus.textContent = "Saving Todo plan…";
  els.todoStatus.className = "overview-status loading";
  try {
    state.todoBoard = await api("/api/todos/save", {
      projectRoot: state.projectRoot,
      todoId: selected.id,
      content: els.todoDocument.value
    });
    state.selectedTodoId = state.todoBoard.todos.find((todo) => todo.title === selected.title)?.id || "";
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
    const result = await api("/api/todos/push", { projectRoot: state.projectRoot });
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
  syncTargetFromForm();
  if (state.targetMode !== "local") return selectTab("environment");
  els.overviewStatus.textContent = "Refreshing LOC, usage, and Git history…";
  els.overviewStatus.className = "overview-status loading";
  els.overviewRefreshButton.disabled = true;
  try {
    const response = await api("/api/overview", { projectRoot: state.projectRoot, commitLimit: 30 });
    state.overview = response;
    state.projectRoot = response.projectRoot;
    els.projectRoot.value = response.projectRoot;
    renderOverview();
    const failures = [response.loc, response.tokens, response.git].filter((part) => !part.ok).length;
    els.overviewStatus.textContent = failures ? `Loaded with ${failures} unavailable data source${failures === 1 ? "" : "s"}` : "All project signals are current";
    els.overviewStatus.className = `overview-status ${failures ? "warning" : "ok"}`;
  } catch (error) {
    els.overviewStatus.textContent = error.message;
    els.overviewStatus.className = "overview-status error";
  } finally {
    els.overviewRefreshButton.disabled = false;
  }
}

function renderOverview() {
  const response = state.overview;
  const projectName = response.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || "Project";
  els.overviewTitle.textContent = projectName;
  els.projectSummary.textContent = response.projectRoot;
  renderLoc(response.loc);
  renderTokens(response.tokens);
  renderGit(response.git);
}

function renderLoc(result) {
  els.locError.hidden = result.ok;
  els.locError.textContent = result.ok ? "" : result.error;
  els.locBreakdown.textContent = "";
  if (!result.ok) {
    els.locTotal.textContent = "—";
    els.locFiles.textContent = "—";
    els.locSplit.textContent = "LOC unavailable";
    els.locFilesSplit.textContent = "File counts unavailable";
    return;
  }
  const data = result.data;
  els.locTotal.textContent = formatNumber(data.totals.code);
  els.locFiles.textContent = formatNumber(data.totals.codeFiles);
  els.locFilesSplit.textContent = `${formatNumber(data.totals.files)} total − ${formatNumber(data.totals.testFiles)} test files`;
  els.locSplit.textContent = `${formatNumber(data.totals.lines)} total − ${formatNumber(data.totals.tests)} tests (${data.testPercent}%)`;
  els.locScope.textContent = data.scope;
  const extraAreas = new Set(["runtime", "ui", "daemon"]);
  const buckets = [
    ...data.modules,
    ...data.areas.filter((item) => extraAreas.has(item.name))
  ].sort((a, b) => b.code - a.code || a.name.localeCompare(b.name));
  const max = Math.max(1, ...buckets.map((item) => item.code));
  for (const item of buckets.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    const head = document.createElement("div");
    head.className = "breakdown-head";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const value = document.createElement("span");
    value.textContent = `${formatNumber(item.code)} lines · ${formatNumber(item.tests)} tests`;
    head.append(name, value);
    const track = document.createElement("div");
    track.className = "breakdown-track";
    const bar = document.createElement("span");
    bar.style.width = `${Math.max(2, (item.code / max) * 100)}%`;
    track.append(bar);
    row.append(head, track);
    els.locBreakdown.append(row);
  }
}

function renderTokens(result) {
  els.tokenError.hidden = result.ok;
  els.tokenError.textContent = result.ok ? "" : result.error;
  els.tokenBreakdown.textContent = "";
  els.tokenDaily.textContent = "";
  if (!result.ok) {
    els.tokenTotal.textContent = "—";
    els.tokenCost.textContent = "—";
    els.tokenSplit.textContent = "Usage unavailable";
    return;
  }
  const { totals, daily } = result.data;
  els.tokenTotal.textContent = compactNumber(totals.totalTokens);
  els.tokenCost.textContent = formatCost(totals.costUSD);
  els.tokenSplit.textContent = `${compactNumber(totals.inputTokens)} input · ${compactNumber(totals.outputTokens)} output`;
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
    const title = document.createElement("strong");
    title.className = "daily-title";
    title.textContent = "Recent days";
    els.tokenDaily.append(title);
    for (const day of daily.slice(0, 7)) {
      const item = document.createElement("div");
      item.className = "daily-row";
      item.innerHTML = `<span></span><strong></strong><small></small>`;
      item.querySelector("span").textContent = day.date;
      item.querySelector("strong").textContent = compactNumber(day.totalTokens);
      item.querySelector("small").textContent = formatCost(day.costUSD);
      els.tokenDaily.append(item);
    }
  }
}

function renderGit(result) {
  els.gitError.hidden = result.ok;
  els.gitError.textContent = result.ok ? "" : result.error;
  els.commitList.textContent = "";
  els.gitBranch.textContent = result.ok ? result.data.branch : "Unavailable";
  if (!result.ok) return;
  for (const commit of result.data.commits) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `commit-item${commit.hash === state.selectedCommit ? " active" : ""}`;
    button.innerHTML = `<span class="commit-dot"></span><span class="commit-copy"><strong></strong><small></small></span><span class="commit-stats"><span class="additions"></span><span class="deletions"></span></span><code></code>`;
    button.querySelector("strong").textContent = commit.subject;
    button.querySelector("small").textContent = `${commit.author} · ${relativeDate(commit.date)}`;
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
    const details = await api("/api/git/commit", { projectRoot: state.projectRoot, commit });
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

async function loadDiff(commit, filePath, button) {
  state.selectedDiffPath = filePath;
  for (const item of els.changedFiles.children) item.classList.toggle("active", item === button);
  els.diffTitle.textContent = filePath;
  els.diffStatus.textContent = "Loading patch…";
  els.diffViewer.textContent = "";
  try {
    const result = await api("/api/git/diff", { projectRoot: state.projectRoot, commit, path: filePath });
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
  const totals = scanTotals();
  els.projectSummary.textContent = state.scan
    ? `${state.targetMode.toUpperCase()} ${state.scan.files.length} files, ${totals.total} variables`
    : "Local Pandemonium env files";
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
  els.docsText.textContent = file.docs || "No configuration docs section found for this file.";
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
  els.projectRoot.value = state.projectRoot;
  els.sshHost.value = state.ssh.host;
  els.sshIdentityFile.value = state.ssh.identityFile;
  els.sshProjectRoot.value = state.ssh.projectRoot;
  els.sshLiveEnvRoot.value = state.ssh.liveEnvRoot;
  els.sshRootEnvPath.value = state.ssh.rootEnvPath;
  els.sshSudo.checked = state.ssh.sudo;
}

function renderTargetMode() {
  const ssh = state.targetMode === "ssh";
  els.sshPanel.hidden = !ssh;
  els.detectSshButton.hidden = !ssh;
  els.localTarget.hidden = ssh;
  document.body.classList.toggle("ssh-target", ssh);
  els.overviewTab.disabled = ssh;
  els.todoTab.disabled = ssh;
  els.overviewTab.title = ssh ? "Overview currently uses a local Git checkout" : "Project overview";
  els.todoTab.title = ssh ? "Todo plans currently use a local Git checkout" : "README Todo plans";
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
    timeStyle: "short"
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
