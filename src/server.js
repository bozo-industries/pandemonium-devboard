import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeEnvFile } from "./env.js";
import { DEFAULT_PROJECT_ROOT, scanPandemoniumProject } from "./pandemonium.js";
import { detectSshPandemoniumTarget, saveEnvFileOverSsh, scanPandemoniumProjectOverSsh } from "./ssh.js";
import { analyzeLoc } from "./loc.js";
import { loadTokenUsage } from "./tokenUsage.js";
import { commitDetails, commitFileDiff, pushBranch, recentCommits } from "./git.js";
import { loadLocalSshTarget, saveLocalSshTarget } from "./localSettings.js";
import { deleteTodo, loadTodoBoard, pushTodoChanges, saveTodoDocument } from "./todos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const port = Number(process.env.ENV_MANAGER_PORT || 5177);
const host = process.env.ENV_MANAGER_HOST || "127.0.0.1";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/api/defaults" && request.method === "POST") {
      return sendJson(response, 200, {
        projectRoot: DEFAULT_PROJECT_ROOT,
        ssh: await loadLocalSshTarget()
      });
    }

    if (url.pathname === "/api/settings/ssh" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, { ssh: await saveLocalSshTarget(body.ssh) });
    }

    if (url.pathname === "/api/todos" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await loadTodoBoard(body.projectRoot || DEFAULT_PROJECT_ROOT));
    }

    if (url.pathname === "/api/todos/save" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await saveTodoDocument(body.projectRoot || DEFAULT_PROJECT_ROOT, body.todoId, body.content, body.title));
    }

    if (url.pathname === "/api/todos/delete" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await deleteTodo(body.projectRoot || DEFAULT_PROJECT_ROOT, body.todoId));
    }

    if (url.pathname === "/api/todos/push" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await pushTodoChanges(body.projectRoot || DEFAULT_PROJECT_ROOT));
    }

    if (url.pathname === "/api/overview" && request.method === "POST") {
      const body = await readJsonBody(request);
      const projectRoot = path.resolve(body.projectRoot || DEFAULT_PROJECT_ROOT);
      const [loc, git, tokens] = await Promise.allSettled([
        analyzeLoc(projectRoot),
        recentCommits(projectRoot, body.commitLimit),
        loadTokenUsage()
      ]);
      return sendJson(response, 200, {
        projectRoot,
        loc: settledPayload(loc),
        git: settledPayload(git),
        tokens: settledPayload(tokens)
      });
    }

    if (url.pathname === "/api/overview/loc" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await analyzeLoc(path.resolve(body.projectRoot || DEFAULT_PROJECT_ROOT)));
    }

    if (url.pathname === "/api/overview/git" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await recentCommits(path.resolve(body.projectRoot || DEFAULT_PROJECT_ROOT), body.commitLimit));
    }

    if (url.pathname === "/api/overview/tokens" && request.method === "POST") {
      return sendJson(response, 200, await loadTokenUsage());
    }

    if (url.pathname === "/api/git/commit" && request.method === "POST") {
      const body = await readJsonBody(request);
      const details = await commitDetails(body.projectRoot || DEFAULT_PROJECT_ROOT, body.commit);
      return sendJson(response, 200, details);
    }

    if (url.pathname === "/api/git/diff" && request.method === "POST") {
      const body = await readJsonBody(request);
      const diff = await commitFileDiff(body.projectRoot || DEFAULT_PROJECT_ROOT, body.commit, body.path);
      return sendJson(response, 200, diff);
    }

    if (url.pathname === "/api/git/push" && request.method === "POST") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await pushBranch(body.projectRoot || DEFAULT_PROJECT_ROOT));
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      const body = await readJsonBody(request);
      const scan = await scanTarget(body);
      return sendJson(response, 200, scan);
    }

    if (url.pathname === "/api/detect-ssh" && request.method === "POST") {
      const body = await readJsonBody(request);
      const detected = await detectSshPandemoniumTarget(body.ssh || await loadLocalSshTarget());
      return sendJson(response, 200, detected);
    }

    if (url.pathname === "/api/save" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (body.targetMode === "ssh") {
        const scan = await saveEnvFileOverSsh(body.ssh || await loadLocalSshTarget(), body.envPath, body.values || {}, body.deleteKeys || []);
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
      await writeEnvFile(targetPath, body.values || {}, { deleteKeys: body.deleteKeys || [] });
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
  console.log(`Local Dev Dashboard listening on http://${host}:${port}`);
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
  if (filePath.endsWith(".png")) return "image/png";
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
    return scanPandemoniumProjectOverSsh(body.ssh || await loadLocalSshTarget());
  }
  return scanPandemoniumProject(body.projectRoot || DEFAULT_PROJECT_ROOT);
}

function settledPayload(result) {
  if (result.status === "fulfilled") return { ok: true, data: result.value };
  return {
    ok: false,
    error: result.reason instanceof Error ? result.reason.message : String(result.reason)
  };
}
