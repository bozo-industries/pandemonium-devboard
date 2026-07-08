import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeEnvFile } from "./env.js";
import { DEFAULT_PROJECT_ROOT, scanPandemoniumProject } from "./pandemonium.js";
import { DEFAULT_SSH_TARGET, detectSshPandemoniumTarget, saveEnvFileOverSsh, scanPandemoniumProjectOverSsh } from "./ssh.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const port = Number(process.env.ENV_HELPER_PORT || 5177);
const host = process.env.ENV_HELPER_HOST || "127.0.0.1";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/api/scan" && request.method === "POST") {
      const body = await readJsonBody(request);
      const scan = await scanTarget(body);
      return sendJson(response, 200, scan);
    }

    if (url.pathname === "/api/detect-ssh" && request.method === "POST") {
      const body = await readJsonBody(request);
      const detected = await detectSshPandemoniumTarget(body.ssh || DEFAULT_SSH_TARGET);
      return sendJson(response, 200, detected);
    }

    if (url.pathname === "/api/save" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (body.targetMode === "ssh") {
        const scan = await saveEnvFileOverSsh(body.ssh || DEFAULT_SSH_TARGET, body.envPath, body.values || {});
        return sendJson(response, 200, scan);
      }
      const projectRoot = path.resolve(body.projectRoot || DEFAULT_PROJECT_ROOT);
      const envPath = normalizeRelativePath(body.envPath || "");
      if (!envPath) {
        return sendJson(response, 400, { error: "envPath is required" });
      }
      const targetPath = path.resolve(projectRoot, envPath);
      if (!isInside(projectRoot, targetPath)) {
        return sendJson(response, 400, { error: "envPath must stay inside the project root" });
      }
      await writeEnvFile(targetPath, body.values || {});
      const scan = await scanPandemoniumProject(projectRoot);
      return sendJson(response, 200, scan);
    }

    if (request.method === "GET") {
      return serveStatic(response, url.pathname);
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`Env Helper listening on http://${host}:${port}`);
  console.log(`Default project: ${DEFAULT_PROJECT_ROOT}`);
});

async function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDir, `.${decodeURIComponent(requestedPath)}`);
  if (!isInside(publicDir, filePath)) {
    return sendText(response, 403, "Forbidden", "text/plain");
  }
  try {
    const content = await fs.readFile(filePath);
    sendText(response, 200, content, contentType(filePath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return sendText(response, 404, "Not found", "text/plain");
    }
    throw error;
  }
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 2_000_000) {
      throw new Error("Request body too large");
    }
  }
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  sendText(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendText(response, status, payload, type) {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store"
  });
  response.end(payload);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function scanTarget(body) {
  if (body.targetMode === "ssh") {
    return scanPandemoniumProjectOverSsh(body.ssh || DEFAULT_SSH_TARGET);
  }
  return scanPandemoniumProject(body.projectRoot || DEFAULT_PROJECT_ROOT);
}
