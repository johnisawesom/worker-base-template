import "dotenv/config";
import http from "node:http";
import { logger } from "./qdrant-logger.js";

// ── Env validation ────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const BOT_NAME = process.env["BOT_NAME"] ?? "worker-base";
const PORT = parseInt(process.env["PORT"] ?? "8080", 10);
const WORKER_INTERVAL_MS = parseInt(process.env["WORKER_INTERVAL_MS"] ?? "60000", 10);

// ── Health check HTTP server ──────────────────────────────────────────────────

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", bot: BOT_NAME, ts: new Date().toISOString() }));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), bot: BOT_NAME, msg: `Health server listening on :${PORT}` }));
  });

  return server;
}

// ── Worker loop ───────────────────────────────────────────────────────────────

async function doWork(): Promise<void> {
  // TODO: Replace this with your actual worker logic.
  // Example: scrape a page, process a queue item, check an API, etc.
  await logger.info("Worker tick", { interval_ms: WORKER_INTERVAL_MS });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function setupGracefulShutdown(server: http.Server, interval: NodeJS.Timeout): void {
  async function shutdown(signal: string): Promise<void> {
    await logger.info("Shutting down", { signal });
    clearInterval(interval);
    server.close(() => process.exit(0));
    // Force exit after 10s if connections are stuck
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// ── Unhandled errors ──────────────────────────────────────────────────────────

process.on("uncaughtException", (error: Error) => {
  void logger.error("Uncaught exception", error, { fatal: true });
  setTimeout(() => process.exit(1), 2_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  void logger.error("Unhandled promise rejection", reason, { fatal: true });
  setTimeout(() => process.exit(1), 2_000).unref();
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate required secrets
  try {
    requireEnv("QDRANT_URL");
    requireEnv("QDRANT_COLLECTION");
  } catch (err) {
    console.error("Startup failed:", (err as Error).message);
    process.exit(1);
  }

  // Log startup
  await logger.info("Bot starting up", {
    bot_name: BOT_NAME,
    node_version: process.version,
    env: process.env["NODE_ENV"] ?? "development",
  });

  // Start HTTP health server
  const server = startHealthServer();

  // Run first tick immediately
  try {
    await doWork();
  } catch (err) {
    await logger.error("Worker tick failed", err, { tick: 0 });
  }

  // Schedule recurring work
  let tick = 1;
  const interval = setInterval(async () => {
    try {
      await doWork();
    } catch (err) {
      await logger.error("Worker tick failed", err, { tick });
    }
    tick++;
  }, WORKER_INTERVAL_MS);

  setupGracefulShutdown(server, interval);
}

main().catch((err) => {
  console.error("Fatal error in main():", err);
  process.exit(1);
});
