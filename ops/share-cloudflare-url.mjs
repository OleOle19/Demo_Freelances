import { spawn } from "node:child_process";

const isStable = process.argv.includes("--stable");
const targetPort = isStable ? 4000 : 5173;
const targetUrl = `http://localhost:${targetPort}`;

const child = spawn("cloudflared", ["tunnel", "--url", targetUrl], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: true
});

let resolved = false;
let bufferedError = "";

function printHeader() {
  console.log(
    `Creando URL publica con Cloudflare para ${targetUrl} ${isStable ? "(modo estable)" : "(modo dev)"}...`
  );
}

function handleChunk(chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && !resolved) {
      resolved = true;
      console.log("");
      console.log("URL publica lista:");
      console.log(match[0]);
      if (isStable) {
        console.log("");
        console.log(`Comparte directo: ${match[0]}`);
      }
    }

    if (!resolved) {
      console.log(`[cloudflared] ${line}`);
    }
  }
}

printHeader();

child.stdout.on("data", handleChunk);
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  bufferedError += text;
  handleChunk(chunk);
});

child.on("exit", (code) => {
  if (resolved) {
    console.log("");
    console.log("Cloudflare Tunnel finalizado.");
    process.exit(code ?? 0);
  }

  console.error("");
  console.error("No se pudo generar la URL publica.");
  if (bufferedError.trim()) {
    console.error(bufferedError.trim());
  }
  process.exit(code ?? 1);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});
