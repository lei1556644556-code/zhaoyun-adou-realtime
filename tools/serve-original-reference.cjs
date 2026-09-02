#!/usr/bin/env node

/* Local, read-only browser runner for an extracted Laya reference build. */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const referenceRoot = path.resolve(process.argv[2] || "");
const engineRoot = process.argv[3] ? path.resolve(process.argv[3]) : referenceRoot;
const port = Number(process.argv[4] || 4174);

if (!process.argv[2] || !fs.existsSync(referenceRoot)) {
  console.error("Usage: node tools/serve-original-reference.cjs <restored-root> [web-engine-root] [port]");
  process.exit(2);
}

const mimeTypes = {
  ".atlas": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".lh": "application/json; charset=utf-8",
  ".ls": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

const runner = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>本地规则核对参考</title>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#888}canvas{display:block}</style>
</head>
<body>
  <script src="/engine/laya.core.js"></script>
  <script src="/engine/laya.webgl_2D.js"></script>
  <script src="/engine/laya.ui.js"></script>
  <script src="/engine/laya.trailCommon.js"></script>
  <script src="/engine/laya.trail2D.js"></script>
  <script src="/engine/spine-core-3.7.js"></script>
  <script src="/engine/laya.spine.js"></script>
  <script>
    // Research-only hooks: keep references to decoded inline configuration.
    window.__referenceParses = [];
    window.__referenceMaps = [];
    const originalJsonParse = JSON.parse.bind(JSON);
    JSON.parse = function referenceParse(text, ...args) {
      const value = originalJsonParse(text, ...args);
      if (typeof text === "string" && text.length <= 250000) {
        window.__referenceParses.push({ text, value });
      }
      return value;
    };
    const OriginalMap = window.Map;
    window.Map = class ReferenceTrackedMap extends OriginalMap {
      constructor(...args) {
        super(...args);
        window.__referenceMaps.push(this);
      }
    };
  </script>
  <script src="/js/bundle.js"></script>
  <script src="/js/index.js"></script>
</body>
</html>`;

const server = http.createServer((request, response) => {
  if (!request.url || request.url === "/" || request.url.startsWith("/?")) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(runner);
    return;
  }

  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const fromEngine = pathname.startsWith("/engine/");
  const selectedRoot = fromEngine ? engineRoot : referenceRoot;
  const relativePath = fromEngine ? pathname.substring("/engine".length) : pathname;
  const target = path.resolve(selectedRoot, `.${relativePath}`);
  const rootWithSep = selectedRoot.endsWith(path.sep) ? selectedRoot : `${selectedRoot}${path.sep}`;
  if (!target.startsWith(rootWithSep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const mime = mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  fs.createReadStream(target).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Reference build: http://127.0.0.1:${port}`);
  console.log(`Serving read-only files from: ${referenceRoot}`);
  console.log(`Using browser engine files from: ${engineRoot}`);
});
