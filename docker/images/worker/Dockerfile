# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS bun

FROM node:24-bookworm-slim AS pruner
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
RUN bun --version && node --version
COPY . .
RUN bun x turbo prune @cmdclaw/worker --docker --out-dir /tmp/pruned
RUN bun -e 'const fs = require("fs"); for (const path of ["/tmp/pruned/json/package.json", "/tmp/pruned/full/package.json"]) { const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.workspaces = pkg.workspaces.filter((entry) => entry !== "docs"); fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`); }'

FROM oven/bun:1.3.14 AS deps
WORKDIR /app
RUN bun --version
COPY --from=pruner /tmp/pruned/json/ ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1.3.14 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruner /tmp/pruned/full/ ./
RUN NODE_ENV=development bun install
RUN bun run --cwd apps/worker bundle
WORKDIR /app/apps/worker
CMD ["bun", "dist/index.js"]
