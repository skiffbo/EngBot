import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDailyLesson } from "../lib/dailyLesson.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/daily-lesson.json") {
      const lesson = await getDailyLesson({
        forceRefresh: url.searchParams.get("force") === "1",
        variant: url.searchParams.get("variant") || "daily",
        sourceKey: url.searchParams.get("source") || undefined
      });
      sendJson(response, 200, lesson);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, {
      error: "server_error",
      message: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

server.listen(port, host, () => {
  console.log(`Daily English Studio running at http://${host}:${port}`);
});

async function serveStatic(urlPath, response) {
  const safePath = path
    .normalize(decodeURIComponent(urlPath))
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]/, "");
  const filePath = path.join(publicRoot, safePath || "index.html");
  const resolved = filePath.endsWith(path.sep) ? path.join(filePath, "index.html") : filePath;
  const fileStat = await stat(resolved).catch(() => null);

  if (!fileStat?.isFile()) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(resolved)] || "application/octet-stream"
  });
  createReadStream(resolved).pipe(response);
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(data)}\n`);
}
