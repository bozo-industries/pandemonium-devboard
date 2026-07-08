# Env Helper

Tiny local-first editor for Pandemonium/Bahnapp env files.

It scans a Pandemonium project root, discovers daemon and module-owned env files,
loads the latest `.env.example` / `deploy/env/*.env.example` / module
`.env.example` templates from `bozo-industries/Pandemonium@master` as the
example underlay, overlays live `.env` values, and shows the matching
`docs/configuration.md` section next to the editor.

No auth and no remote vault. It only serves the local browser UI, shells out to
SSH when requested, and fetches read-only Pandemonium examples from GitHub.

## SSH Targets

Switch the target mode to `SSH` to scan a Linux deployment through your existing
SSH access. Env Helper does not store credentials; it shells out to `ssh` and
runs a small Node script on the remote host.

Defaults:

```text
host: user@192.168.1.82
ssh key: C:\Users\user\.ssh\codex_claraos_ed25519
checkout: /opt/pandemonium
live env folder: /etc/pandemonium
root env: /etc/pandemonium.env
```

Use `Detect` to read `pandemonium.service` through systemd when the SSH user can
access it. Detection tries `WorkingDirectory`, `ExecStart`, `EnvironmentFile`,
and `SERVICE_ENV_FILE_1` to fill the checkout and live env paths. Enable
`sudo -n` only when the remote user has passwordless sudo for those reads/writes.

## Run

```powershell
cd C:\Users\user\Code\Env-helper
npm start
```

Open <http://127.0.0.1:5177>.

The default project root is:

```text
C:\Users\user\Documents\Bahnapp-calendar-bridge
```

## Test

```powershell
npm test
```
