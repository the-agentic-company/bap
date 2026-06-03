# syntax=docker/dockerfile:1

FROM oven/bun:1.3.9 AS bun

FROM node:24-bookworm-slim AS pruner
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
RUN bun --version && node --version
COPY . .
RUN bun x turbo prune --scope=@cmdclaw/web --docker --out-dir /tmp/pruned
RUN bun -e 'const fs = require("fs"); for (const path of ["/tmp/pruned/json/package.json", "/tmp/pruned/full/package.json"]) { const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.workspaces = pkg.workspaces.filter((entry) => entry !== "docs"); fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`); }'
RUN mkdir -p /tmp/pruned/full/packages/config
RUN cp -R /app/packages/config/. /tmp/pruned/full/packages/config/

FROM node:24-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=pruner /tmp/pruned/json/ ./
RUN NODE_ENV=development bun install --frozen-lockfile --ignore-scripts
COPY --from=pruner /tmp/pruned/full/ ./
WORKDIR /app/apps/web
ENV NODE_ENV=production
ARG SKIP_ENV_VALIDATION=1
ARG BETTER_AUTH_SECRET
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV SKIP_ENV_VALIDATION=${SKIP_ENV_VALIDATION}
ENV BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST}
# Build the TanStack Start app (Vite). Emits Nitro's production Node server in .output.
RUN NODE_OPTIONS=--max-old-space-size=8192 bun x vite build

FROM node:24-bookworm-slim AS runner
WORKDIR /app/apps/web
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/package.json ./package.json
COPY --from=builder /app/apps/web/src/env.js ./src/env.js
COPY --from=builder /app/apps/sandbox /app/apps/sandbox
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.output ./.output
COPY --from=builder /app/apps/web/node_modules ./node_modules
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages /app/packages
EXPOSE 3000
# Nitro's Node server binds to PORT / HOST (set by Render).
CMD ["node", ".output/server/index.mjs"]
