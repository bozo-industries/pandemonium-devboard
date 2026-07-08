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
  fileTitle: document.querySelector("#fileTitle"),
  fileMeta: document.querySelector("#fileMeta"),
  statusLine: document.querySelector("#statusLine"),
  rows: document.querySelector("#rows"),
  emptyState: document.querySelector("#emptyState"),
  showUnderlay: document.querySelector("#showUnderlay"),
  showDocs: document.querySelector("#showDocs"),
  revealValues: document.querySelector("#revealValues"),
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
  for (const row of file.rows) {
    const nextValue = draft.get(row.key);
    if (nextValue !== undefined && nextValue !== row.actualValue) {
      changedValues[row.key] = nextValue;
    }
  }

  if (Object.keys(changedValues).length === 0) {
    setStatus("No local edits to save.");
    return;
  }

  setStatus(`Saving ${Object.keys(changedValues).length} change(s) to ${file.livePath || file.envPath}...`, "dirty");
  els.saveButton.disabled = true;
  try {
    const response = await api("/api/save", {
      ...scanPayload(),
      projectRoot: state.projectRoot,
      envPath: file.envPath,
      values: changedValues
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
  els.projectSummary.textContent = state.scan
    ? `${state.targetMode.toUpperCase()} ${state.scan.files.length} files, ${state.scan.files.reduce((sum, file) => sum + file.stats.total, 0)} variables`
    : "Pandemonium secrets";
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
        <span class="file-stats"></span>
      `;
      button.querySelector(".file-path").textContent = file.envPath;
      button.querySelector(".file-stats").textContent = `${file.stats.set} set, ${file.stats.empty} empty, ${file.stats.missing} missing`;
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
    els.saveButton.disabled = true;
    return;
  }

  els.fileTitle.textContent = file.owner;
  els.fileMeta.textContent = `${file.livePath ? `${file.livePath} as ` : ""}${file.envPath}${file.examplePath ? ` underlay ${file.examplePath}` : ""}`;
  els.docsText.textContent = file.docs || "No configuration docs section found for this file.";
  els.emptyState.hidden = true;
  els.rows.hidden = false;
  els.rows.textContent = "";

  const draft = draftFor(file);
  const showUnderlay = els.showUnderlay.checked;
  const reveal = els.revealValues.checked;

  for (const row of file.rows) {
    const wrapper = document.createElement("div");
    wrapper.className = `env-row${showUnderlay ? "" : " no-underlay"}`;

    const keyCell = document.createElement("div");
    const key = document.createElement("div");
    key.className = "key";
    key.textContent = row.key;
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
    input.rows = rowValue(row, draft).includes("\n") ? 4 : 1;
    input.spellcheck = false;
    input.value = rowValue(row, draft);
    input.placeholder = showUnderlay && row.exampleValue ? row.exampleValue : "";
    input.dataset.key = row.key;
    input.style.webkitTextSecurity = !reveal && input.value ? "disc" : "";
    if (draft.has(row.key) && draft.get(row.key) !== row.actualValue) {
      input.classList.add("changed");
    }
    input.addEventListener("input", () => {
      draft.set(row.key, input.value);
      updateDirtyState(file);
      input.classList.toggle("changed", input.value !== row.actualValue);
    });
    valueCell.append(input);

    const status = document.createElement("span");
    status.className = `status-pill status-${row.status}`;
    status.textContent = row.status;

    wrapper.append(keyCell, valueCell);
    if (showUnderlay) {
      const underlay = document.createElement("div");
      underlay.className = "underlay";
      underlay.textContent = row.hasExample ? row.exampleValue || "(empty example)" : "No example";
      wrapper.append(underlay);
    }
    wrapper.append(status);
    els.rows.append(wrapper);
  }

  updateDirtyState(file);
}

function updateDirtyState(file) {
  const draft = draftFor(file);
  state.dirty = file.rows.some((row) => draft.has(row.key) && draft.get(row.key) !== row.actualValue);
  els.saveButton.disabled = !state.dirty;
  if (state.dirty) {
    setStatus("Unsaved local edits", "dirty");
  } else if (!els.statusLine.classList.contains("error")) {
    setStatus(`Loaded ${file.livePath || file.envPath}`);
  }
}

function draftFor(file) {
  if (!state.drafts.has(file.id)) {
    state.drafts.set(file.id, new Map(file.rows.map((row) => [row.key, row.actualValue])));
  }
  return state.drafts.get(file.id);
}

function rowValue(row, draft) {
  return draft.has(row.key) ? draft.get(row.key) : row.actualValue;
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
  els.projectRoot.hidden = ssh;
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

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}
