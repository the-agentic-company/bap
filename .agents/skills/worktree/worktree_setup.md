# Repository Worktree Setup

This file captures the repository-specific worktree setup for the CLI bundled with this skill. Keep generic agent guidance in [SKILL.md](SKILL.md); keep concrete commands, ports, environment variables, and service topology here.

This repository has a dedicated worktree flow for running isolated app processes with a shared local Docker model:

- shared stateful services for Postgres, Redis, and MinIO
- one shared observability stack for Vector, VictoriaMetrics, VictoriaLogs, VictoriaTraces, Grafana, Alertmanager, and vmalert
- per-worktree app processes for the web app, worker, and WS runtime

## When to use it

Use a worktree when you want to run multiple copies of the application stack side by side without port collisions between:

- the web app
- the worker
- the WS runtime
- Daytona ports when that profile is enabled

The worktree lifecycle enforces a cap of ten running worktree web development servers. Starting an eleventh worktree web server fails fast and tells you to stop another worktree first.

## Main idea

Each worktree gets:

- a stable `instanceId`
- its own app and WS ports
- its own Postgres database and Postgres role on the shared Postgres server
- its own Redis ACL user and Redis key namespace on the shared Redis server
- its own MinIO bucket and MinIO credentials on the shared MinIO server
- a 2-digit stack slot used to derive worktree-only ports such as `37xx`, `47xx`, and optional Daytona ports
- shared observability endpoints, with telemetry labeled by `BAP_INSTANCE_ID`, `BAP_WORKTREE_ID`, and `BAP_WORKTREE_SLOT`

Example:

- slot `07` maps to app port `3707`
- slot `07` maps to WS port `4707`
- all worktrees still send logs, metrics, and traces to the same shared local observability stack

## Start a worktree app

From inside the worktree:

```bash
bun .agents/skills/worktree/cli/src/cli.ts setup
```

This fails fast if Docker is not installed or the Docker daemon is not running. Otherwise it reuses the repo-global `bap-local` shared infrastructure (starting the missing shared services there only when needed), provisions the worktree-specific Postgres, Redis, and MinIO credentials, writes the generated `.env`, and starts the web, worker, and WS processes for that worktree.

If ten worktree web servers are already running, `setup` fails before launching another web dev process.

Each worktree writes a computed `.env` file at the repo root. That file is the authoritative runtime env for worktree commands and normal repo scripts inside that worktree, including `setup`, `dev`, and `bun run cli ...`.

Per-worktree state no longer lives inside the repo checkout. Metadata, process tracking, logs, and runtime artifacts now live under `~/.bap/worktrees/instances/<instanceId>`, which prevents Turbopack from watching a repo-local `.worktrees` directory and recompiling whenever worktree state changes.

## Start only the Docker stack

If you only want Docker without starting the app processes:

```bash
bun .agents/skills/worktree/cli/src/cli.ts docker-up
```

This reuses the repo-global `bap-local` shared stateful services and shared observability services for the current worktree.

There is no longer a `docker/compose/worktree-observability.yml` flow. Worktrees always target the shared observability services defined in `docker/compose/dev.yml`.

## Stop the worktree Docker stack

Keep using the worktree-aware Docker teardown command instead of plain `docker compose down`:

```bash
bun .agents/skills/worktree/cli/src/cli.ts docker-down
```

This does not stop a worktree-local Docker stack because there is no longer one. The command stays in place so the command surface remains stable; it prints that observability is shared and that there is nothing worktree-scoped to stop.

## Inspect the assigned values

To see the current worktree assignment:

```bash
bun .agents/skills/worktree/cli/src/cli.ts status
bun .agents/skills/worktree/cli/src/cli.ts processes
bun .agents/skills/worktree/cli/src/cli.ts env
```

`status` shows the instance id, stack slot, app URL, database name, the shared Docker project, and the derived local addresses for shared stateful services and shared observability endpoints.

It also shows the exact `.env` path currently backing the worktree, plus the shared instance root under `~/.bap/worktrees/instances/<instanceId>`.

`env` prints the full derived environment for the worktree, including the worktree-scoped `DATABASE_URL`, `REDIS_URL`, `AWS_ENDPOINT_URL`, the shared Vector and Victoria URLs, and the worktree identity labels used to filter telemetry.

`processes` can be run from the main checkout or a worktree. It groups running worktree app processes by worktree, summarizes discovered web dev descendants, and prints the exact command to stop each worktree. Use `bun .agents/skills/worktree/cli/src/cli.ts processes list --verbose` to include full process command lines.

To stop every running worktree app process from the list:

```bash
bun .agents/skills/worktree/cli/src/cli.ts processes stop all
```

To stop one directly from the list, pass its instance id, slot, app port, or repo path:

```bash
bun .agents/skills/worktree/cli/src/cli.ts processes stop <all|instance-id|slot|app-port|repo-root>
```

## Important rule

For the main repo checkout, plain Docker commands are still fine:

```bash
docker compose -f docker/compose/dev.yml up -d
```

For a worktree checkout, use:

```bash
bun .agents/skills/worktree/cli/src/cli.ts setup
```

Otherwise the worktree runtime will not be provisioned correctly and you can still get port collisions.

## Implementation location

The worktree lifecycle implementation is bundled with this skill:

- `.agents/skills/worktree/cli/src/cli.ts` handles the worktree lifecycle commands
- `.agents/skills/worktree/cli/src/stack.ts` defines the shared and per-worktree port and volume assignments
- `.agents/skills/worktree/cli/src/proxy.ts` runs the local proxy from the main checkout
- `.agents/skills/worktree/hooks/` contains lifecycle hook scripts used by external tools

## Run the CLI in a worktree

When you run the root CLI script from inside a worktree, the generated root `.env` makes the normal CLI path point at the worktree app URL and local database without manual exports or a wrapper.

Example:

```bash
bun .agents/skills/worktree/cli/src/cli.ts setup
bun run cli chat --message "hi" --model openai/gpt-5.4-mini
```
