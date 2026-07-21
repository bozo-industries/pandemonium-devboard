# Local Dev Dashboard

A dependency-light, local-first dashboard for understanding and operating a development checkout from one browser tab.

The default **Overview** tab combines:

- source and test LOC metrics for `src/`, including module and language breakdowns;
- recent Git history with commit metadata, changed files, and per-file patches;
- optional commit Insights with Jolli recaps, topics, and decisions;
- Codex token and cost totals from [`ccusage`](https://ccusage.com/).

The **Environment** tab preserves the original Pandemonium env manager. It discovers daemon and module-owned env files, overlays live values on the latest examples, shows matching configuration docs, and can edit either a local checkout or a Linux deployment over SSH.

Everything is served from a small Node HTTP server on the local network. There is no authentication, remote vault, database, or frontend build step, so access must stay restricted to a network you trust.

## Run

Requirements: Node.js 20+, Git, and `npx` for the Codex usage card.

```powershell
cd C:\Users\user\Code\Env-helper
npm start
```

Open <http://localhost:5177> locally, or use this machine's LAN address (for example, <http://192.168.1.110:5177>) from another device on the same private network. The default project root is `C:\Users\user\Code\Pandemonium`; enter any local Git checkout in the header and select **Refresh overview** to inspect it.

Commit memory is loaded asynchronously through the installed `jolli` CLI. Git details remain available when Jolli is absent or the selected commit has no generated memory.

Optional server settings:

```text
ENV_MANAGER_HOST=0.0.0.0
ENV_MANAGER_PORT=5177
```

## Environment targets

Local mode scans env files inside the selected checkout. SSH mode uses the existing system `ssh` command and never stores credentials.

To prefill a local SSH target, copy `config/ssh-target.example.json` to
`config/ssh-target.local.json` and edit it for your machine. The local file is
gitignored and is loaded only by this local dashboard server.

Use **Detect** to inspect `pandemonium.service` through systemd. Detection checks `WorkingDirectory`, `ExecStart`, `EnvironmentFile`, and `SERVICE_ENV_FILE_1`. Enable `sudo -n` only when the remote user has passwordless sudo for the required reads and writes.

## Data and safety model

- LOC analysis reads only Pandemonium code under `src/` (TypeScript, Python, and SQL), excluding documentation, Todo files, manifests, and configuration.
- Git operations use fixed argument arrays, validated commit IDs and relative paths, timeouts, and a 4 MB output limit.
- Token usage invokes `npx ccusage codex daily --json`; a failure is isolated to that card instead of breaking the rest of the overview.
- Environment writes remain scoped to the selected project root or configured SSH env paths.

## Test

```powershell
npm test
```

The suite covers env parsing and writes, project discovery, LOC grouping, token JSON normalization, Git history, changed-file inspection, and path validation.
