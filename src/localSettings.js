import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localSshTargetPath = path.resolve(__dirname, "..", "config", "ssh-target.local.json");

export const EMPTY_SSH_TARGET = {
  host: "",
  identityFile: "",
  projectRoot: "",
  liveEnvRoot: "",
  rootEnvPath: "",
  sudo: false
};

export async function loadLocalSshTarget() {
  try {
    const parsed = JSON.parse(await fs.readFile(localSshTargetPath, "utf8"));
    return normalizeSshTarget(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return { ...EMPTY_SSH_TARGET };
    if (error instanceof SyntaxError) throw new Error("config/ssh-target.local.json must contain valid JSON");
    throw error;
  }
}

export function normalizeSshTarget(value = {}) {
  return {
    host: stringValue(value.host),
    identityFile: stringValue(value.identityFile),
    projectRoot: stringValue(value.projectRoot),
    liveEnvRoot: stringValue(value.liveEnvRoot),
    rootEnvPath: stringValue(value.rootEnvPath),
    sudo: Boolean(value.sudo)
  };
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
