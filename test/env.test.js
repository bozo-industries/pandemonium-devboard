import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRows, parseEnv, writeEnvFile } from "../src/env.js";
import { scanPandemoniumProject } from "../src/pandemonium.js";

test("parseEnv keeps comments with the following key", () => {
  const parsed = parseEnv("# Important token\nTOKEN=abc\n\nEMPTY=\n");
  assert.equal(parsed.values.TOKEN, "abc");
  assert.equal(parsed.values.EMPTY, "");
  const row = buildRows(parsed, parseEnv("TOKEN=live\n"));
  assert.equal(row[0].key, "TOKEN");
  assert.equal(row[0].comments[0], "Important token");
  assert.equal(row[0].actualValue, "live");
});

test("writeEnvFile updates selected keys and preserves unrelated lines", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "env-manager-"));
  const file = path.join(dir, ".env");
  await fs.writeFile(file, "# keep\nTOKEN=old\nOTHER=yes\n", "utf8");

  await writeEnvFile(file, { TOKEN: "new value", ADDED: "ok" });

  const text = await fs.readFile(file, "utf8");
  assert.match(text, /# keep/);
  assert.match(text, /TOKEN="new value"/);
  assert.match(text, /OTHER=yes/);
  assert.match(text, /ADDED=ok/);
});

test("writeEnvFile deletes selected keys and can add new keys in the same save", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "env-manager-delete-"));
  const file = path.join(dir, ".env");
  await fs.writeFile(file, "# delete me\nTOKEN=old\nKEEP=yes\n", "utf8");

  await writeEnvFile(file, { ADDED: "ok" }, { deleteKeys: ["TOKEN"] });

  const text = await fs.readFile(file, "utf8");
  assert.doesNotMatch(text, /^TOKEN=/m);
  assert.match(text, /KEEP=yes/);
  assert.match(text, /ADDED=ok/);
});

test("scanPandemoniumProject discovers daemon and module env overlays", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "env-manager-project-"));
  await fs.mkdir(path.join(root, "src", "modules", "alpha"), { recursive: true });
  await fs.mkdir(path.join(root, "deploy", "env"), { recursive: true });
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.mkdir(path.join(root, "secrets"), { recursive: true });

  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "pandemonium" }), "utf8");
  await fs.writeFile(path.join(root, ".env.example"), "SERVICE_ENV_FILE_1=secrets/daemon.env\n", "utf8");
  await fs.writeFile(path.join(root, ".env"), "SERVICE_ENV_FILE_1=secrets/daemon.env\n", "utf8");
  await fs.writeFile(path.join(root, "deploy", "env", "daemon.env.example"), "SERVICE_STATE_PATH=.data/state.json\n", "utf8");
  await fs.writeFile(path.join(root, "secrets", "daemon.env"), "SERVICE_STATE_PATH=.data/live.json\n", "utf8");
  await fs.writeFile(path.join(root, "deploy", "env", "alpha.env.example"), "# Alpha token\nALPHA_TOKEN=\n", "utf8");
  await fs.writeFile(path.join(root, "secrets", "alpha.env"), "ALPHA_TOKEN=secret\n", "utf8");
  await fs.writeFile(path.join(root, "src", "modules", "alpha", "pandemonium-module.json"), JSON.stringify({
    id: "alpha",
    name: "Alpha",
    envFiles: ["secrets/alpha.env"]
  }), "utf8");
  await fs.writeFile(path.join(root, "docs", "configuration.md"), [
    "# Pandemonium Configuration",
    "## Daemon Env",
    "`secrets/daemon.env` owns daemon settings.",
    "## Alpha Env",
    "`ALPHA_TOKEN` is for Alpha."
  ].join("\n"), "utf8");

  const scan = await scanPandemoniumProject(root);
  const alpha = scan.files.find((file) => file.envPath === "secrets/alpha.env");
  assert.ok(alpha);
  assert.equal(alpha.examplePath, "deploy/env/alpha.env.example");
  assert.equal(alpha.rows.find((row) => row.key === "ALPHA_TOKEN").actualValue, "secret");
  assert.equal(alpha.rows.find((row) => row.key === "ALPHA_TOKEN").comments[0], "Alpha token");
});
