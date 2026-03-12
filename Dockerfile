# syntax=docker/dockerfile:1
FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── deps stage ──────────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── build stage ──────────────────────────────────────────────────────────────
FROM base AS build

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── release stage ────────────────────────────────────────────────────────────
FROM base AS release

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# If a browser-service variant is ever needed, pin Playwright EXACTLY to 1.40.1:
# RUN npm install playwright-core@1.40.1 playwright@1.40.1 --no-save \
#     && npx playwright@1.40.1 install --with-deps chromium

EXPOSE 8080

# Tini-style graceful shutdown
STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
