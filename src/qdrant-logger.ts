import { QdrantClient } from "@qdrant/js-client-rest";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = "info" | "error" | "warn" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  error?: Error | unknown;
  context?: Record<string, unknown>;
}

export interface QdrantLogPoint {
  timestamp: string;         // ISO 8601
  bot_name: string;
  level: LogLevel;
  message: string;
  error_stack: string | null;
  context: Record<string, unknown>;
  vectorizable_text: string; // clean string for future embedding by Coordinator
}

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (_client) return _client;

  const url = process.env["QDRANT_URL"];
  const apiKey = process.env["QDRANT_API_KEY"];

  if (!url) {
    throw new Error("QDRANT_URL environment variable is required");
  }

  _client = new QdrantClient({ url, apiKey });
  return _client;
}

// ── Collection bootstrap ──────────────────────────────────────────────────────

let _collectionEnsured = false;

async function ensureCollection(client: QdrantClient, collection: string): Promise<void> {
  if (_collectionEnsured) return;

  try {
    await client.getCollection(collection);
  } catch {
    // Collection doesn't exist — create it.
    // Vector size 1536 is a placeholder for future OpenAI/Claude embeddings.
    await client.createCollection(collection, {
      vectors: {
        size: 1536,
        distance: "Cosine",
      },
    });
  }

  _collectionEnsured = true;
}

// ── Core logger ───────────────────────────────────────────────────────────────

export async function logToQdrant(entry: LogEntry): Promise<void> {
  const botName = process.env["BOT_NAME"] ?? "unknown-bot";
  const collection = process.env["QDRANT_COLLECTION"] ?? "openclaw-logs";

  const timestamp = new Date().toISOString();

  // Resolve error stack if present
  let errorStack: string | null = null;
  if (entry.error instanceof Error) {
    errorStack = entry.error.stack ?? entry.error.message;
  } else if (typeof entry.error === "string") {
    errorStack = entry.error;
  }

  const ctx = entry.context ?? {};

  // Build clean text for future vector embedding by Coordinator
  const vectorizableText = [
    botName,
    entry.level,
    entry.message,
    JSON.stringify(ctx),
    errorStack ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const point: QdrantLogPoint = {
    timestamp,
    bot_name: botName,
    level: entry.level,
    message: entry.message,
    error_stack: errorStack,
    context: ctx,
    vectorizable_text: vectorizableText,
  };

  // Also emit structured JSON to stdout for Fly.io log aggregation
  console.log(JSON.stringify(point));

  try {
    const client = getClient();
    await ensureCollection(client, collection);

    // Use a time-based UUID-style ID: millisecond timestamp + random suffix
    const id = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;

    await client.upsert(collection, {
      wait: true,
      points: [
        {
          id: parseInt(id.slice(-15), 10), // Qdrant requires uint64-compatible integer
          // Placeholder zero-vector until Coordinator embeds it
          vector: new Array(1536).fill(0) as number[],
          payload: point as unknown as Record<string, unknown>,
        },
      ],
    });
  } catch (qdrantError) {
    // Never throw from the logger — just emit to stderr so the worker keeps running
    const errMsg = qdrantError instanceof Error ? qdrantError.message : String(qdrantError);
    console.error(
      JSON.stringify({
        timestamp,
        bot_name: botName,
        level: "error",
        message: "Failed to write log to Qdrant",
        error_stack: errMsg,
        context: { original_message: entry.message },
        vectorizable_text: `${botName} error Failed to write log to Qdrant ${errMsg}`,
      })
    );
  }
}

// ── Convenience helpers ───────────────────────────────────────────────────────

export const logger = {
  info: (message: string, context?: Record<string, unknown>) =>
    logToQdrant({ level: "info", message, context }),

  warn: (message: string, context?: Record<string, unknown>) =>
    logToQdrant({ level: "warn", message, context }),

  error: (message: string, error?: Error | unknown, context?: Record<string, unknown>) =>
    logToQdrant({ level: "error", message, error, context }),

  debug: (message: string, context?: Record<string, unknown>) =>
    logToQdrant({ level: "debug", message, context }),
};
