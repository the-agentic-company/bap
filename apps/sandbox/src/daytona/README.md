# Daytona Snapshot Builder

This folder contains Daytona snapshot builders for CmdClaw sandbox runtimes.

## Prerequisites

- `DAYTONA_API_KEY`
- Optional: `DAYTONA_API_URL`, `DAYTONA_SERVER_URL`, and `DAYTONA_TARGET`

## Build snapshots

```bash
bun run daytona:build:dev
bun run daytona:build:staging
bun run daytona:build:prod
```

Defaults:

- dev snapshot: `bap-agent-dev`
- staging snapshot: `bap-agent-staging`
- prod snapshot: `bap-agent-prod`

Override names with:

- `E2B_DAYTONA_SANDBOX_NAME` (shared with runtime)
- `DAYTONA_SNAPSHOT_DEV`
- `DAYTONA_SNAPSHOT_STAGING`
- `DAYTONA_SNAPSHOT_PROD`

If you point `DAYTONA_API_URL` at the local compose stack and the build fails on `http://minio:9000/...`, Daytona is returning a Docker-internal MinIO URL for the snapshot upload. Run the build from a container on the compose network or reconfigure the stack to publish a host-reachable MinIO endpoint such as `http://localhost:9000`.

The builder now rewrites the local compose MinIO endpoint automatically for host-side builds. If your object storage is exposed somewhere else, set `DAYTONA_OBJECT_STORAGE_URL` explicitly.

## Runtime selection

When `DAYTONA_API_KEY` is set and `E2B_API_KEY` is not set, CmdClaw can select Daytona as the sandbox backend for direct mode generations.
