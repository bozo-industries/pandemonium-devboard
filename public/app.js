const DEFAULT_PROJECT_ROOT = "C:\\Users\\user\\Documents\\Bahnapp-calendar-bridge";
const DEFAULT_SSH = {
  host: "user@192.168.1.82",
  identityFile: "C:\\Users\\user\\.ssh\\codex_claraos_ed25519",
  projectRoot: "/opt/pandemonium",
  liveEnvRoot: "/etc/pandemonium",
  rootEnvPath: "/etc/pandemonium.env",
  sudo: false
};

const state = {
  targetMode: "local",
  projectRoot: DEFAULT_PROJECT_ROOT,
  ssh: { ...DEFAULT_SSH },
  scan: null,
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
  docsText: document.querySelector("#docsText")
};

writeTargetToForm();

els.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  syncTargetFromForm();
  scan();
});
els.reloadButton.addEventListener("click", () => scan());
els.detectSshButton.addEventListener("click", detectSsh);
for (const input of els.targetMode) {
  input.addEventListener("change", () => {
    syncTargetFromForm();
    renderTargetMode();
  });
}
els.showUnderlay.addEventListener("change", renderSelectedFile);
els.showDocs.addEventListener("change", renderSelectedFile);
els.revealValues.addEventListener("change", renderSelectedFile);
els.addRowButton.addEventListener("click", addEnvRow);
els.saveButton.addEventListener("click", saveSelectedFile);

renderTargetMode();
scan();

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
