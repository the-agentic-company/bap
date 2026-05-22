# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS pruner
WORKDIR /app
RUN bun --version
COPY . .
RUN bun x turbo prune @cmdclaw/mcp --docker --out-dir /tmp/pruned
RUN bun -e 'const fs = require("fs"); for (const path of ["/tmp/pruned/json/package.json", "/tmp/pruned/full/package.json"]) { const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.workspaces = pkg.workspaces.filter((entry) => entry !== "docs"); fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`); }'
RUN mkdir -p /tmp/pruned/full/packages/config
RUN cp -R /app/packages/config/. /tmp/pruned/full/packages/config/

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
RUN bun run --cwd apps/mcp build
WORKDIR /app/apps/mcp
CMD ["bun", "gateway/dist/index.js"]
