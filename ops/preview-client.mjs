import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, "..", "client", "dist");
const host = "0.0.0.0";
const port = Number(process.env.CLIENT_PREVIEW_PORT || 4173);

if (!fs.existsSync(clientDist)) {
  console.error(
    "No existe client/dist. Ejecuta primero `npm run build:client`."
  );
  process.exit(1);
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"]
]);

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type":
      mimeTypes.get(extension) || "application/octet-stream",
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(
    (request.url || "/").split("?")[0]
  );
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.resolve(clientDist, `.${safePath}`);

  if (!resolvedPath.startsWith(clientDist)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Acceso denegado.");
    return;
  }

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    sendFile(response, resolvedPath);
    return;
  }

  sendFile(response, path.join(clientDist, "index.html"));
});

server.listen(port, host, () => {
  console.log(`Cliente estatico listo en http://localhost:${port}`);
});
