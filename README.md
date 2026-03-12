# worker-base-template

Base template for OpenClaw workers. Copy → rename → customize entrypoint.

## Usage

1. Fork or copy this repo.
2. Rename the app in `fly.toml` (replace `{{app-name}}`).
3. Customize `src/index.ts` with your worker logic.
4. Set required Fly secrets (see below).
5. Deploy: `fly deploy --remote-only --region syd`

## Required Secrets (via `fly secrets set`)

```
QDRANT_URL=https://your-qdrant-instance
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION=openclaw-logs
BOT_NAME=your-bot-name
```

## Stack

- Node.js 20 + TypeScript (ESM)
- Qdrant structured logging (`src/qdrant-logger.ts`)
- Fly.io — Sydney region (`syd`), `shared-cpu-1x`, 256 MB RAM

## Rules

- Stateless worker — no volumes, no local persistence.
- All secrets come from `process.env` only.
- Every startup and error must log structured JSON to Qdrant via `logToQdrant()`.
- Never call Claude or create GitHub PRs — that is the Coordinator's job.
