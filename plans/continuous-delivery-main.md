# Continuous delivery from main

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows `.agents/PLANS.md`.

## Purpose / Big Picture

CmdClaw should deploy automatically when a change lands on `main`. A successful release should deploy staging, verify it, promote the same commit to production, verify production, and leave a readable release history. If production verification fails after production services were updated, the workflow should quickly roll Render services back to their previous successful deploys. Database changes are handled with forward-compatible migrations rather than automatic destructive rollback.

After this work, a user can push to `main` and observe the `Release Main` GitHub Actions workflow deploying staging and production. A successful run creates a tag using the existing production release format, such as `v2026.5.17` or `v2026.5.17-2`.

## Progress

- [x] (2026-05-17 07:20Z) Read repository release, testing, observability, Render, and Daytona context.
- [x] (2026-05-17 07:28Z) Added a Render API helper for deploy, wait, previous deploy discovery, and rollback.
- [x] (2026-05-17 07:33Z) Added a fixture-driven release replay command for conversation and workflow replay cases.
- [x] (2026-05-17 07:42Z) Added reusable GitHub workflows for Daytona build, Render deploy, Render rollback, and deployment verification.
- [x] (2026-05-17 07:50Z) Added the top-level `Release Main` workflow that deploys staging, verifies, promotes to production, verifies, rolls back Render on failed production verification, and creates a release tag.
- [x] (2026-05-17 07:54Z) Updated release documentation to describe the new automatic release and rollback model.
- [x] (2026-05-17 07:59Z) Added an initial replay fixture file that runs chat conversation and coworker builder workflow live tests.
- [x] (2026-05-17 08:02Z) Validated YAML parsing and ran `bun run check` successfully.
- [x] (2026-05-17 08:34Z) Removed Daytona snapshot override secrets from the workflow so staging and production always use the built-in stable names.

## Surprises & Discoveries

- Observation: The repository already had manual staging and production workflows, but they only composed database push and E2B sandbox build.
  Evidence: `.github/workflows/staging-deploy.yml` and `.github/workflows/prod-release.yml` call `db-push.yml` and `e2b-sandbox.yml`.

- Observation: Render supports deploying a specific commit and rolling back to a previous deploy through the API.
  Evidence: Render API docs list `POST /v1/services/{serviceId}/deploys` with `commitId`, and `POST /v1/services/{serviceId}/rollback` with `deployId`.

- Observation: `render.yaml` already sets `SANDBOX_DEFAULT=daytona` and stable Daytona snapshot names for staging and production.
  Evidence: `cmdclaw-web-staging`, `cmdclaw-worker-staging`, `cmdclaw-web-prod`, and `cmdclaw-worker-prod` all set `SANDBOX_DEFAULT` to `daytona` and `E2B_DAYTONA_SANDBOX_NAME` to the environment snapshot name.

## Decision Log

- Decision: Use `main` pushes as the release trigger and create tags only after successful production verification.
  Rationale: The user wants fully automatic deployment from `main`, but tags remain useful as human-readable release history.
  Date/Author: 2026-05-17 / Codex.

- Decision: Keep the previous production tag format `vYYYY.M.D` with numeric same-day suffixes.
  Rationale: The user preferred the existing release tag style and only wanted the trigger changed from tag-driven release to automatic `main` release.
  Date/Author: 2026-05-17 / Codex.

- Decision: Do not expose `DAYTONA_SNAPSHOT_STAGING` or `DAYTONA_SNAPSHOT_PROD` in the GitHub workflow.
  Rationale: The release pipeline should use the standard snapshot names automatically: `cmdclaw-agent-staging` and `cmdclaw-agent-prod`.
  Date/Author: 2026-05-17 / Codex.

- Decision: Use Render API deploy IDs for rollback instead of GHCR image tags.
  Rationale: The user does not currently use GHCR images. Render can deploy a commit directly and roll back to previous deploy artifacts.
  Date/Author: 2026-05-17 / Codex.

- Decision: Keep database recovery forward-compatible rather than automatic rollback.
  Rationale: Rolling back a live database after production writes can corrupt or lose data. Code and Render deploy artifacts can roll back quickly, while schema changes should be additive and safe for old code.
  Date/Author: 2026-05-17 / Codex.

- Decision: Add a fixture-driven replay command rather than embedding production data queries in GitHub Actions.
  Rationale: Historical conversation and workflow replay needs a safe, explicit corpus that can avoid unintended side effects and can be reviewed in PRs.
  Date/Author: 2026-05-17 / Codex.

## Outcomes & Retrospective

The implementation now has an automatic release workflow and reusable deployment primitives. It also includes an initial replay corpus that exercises a chat conversation and coworker builder workflow. Successful production verification creates tags in the previous `vYYYY.M.D` format. The next operational step is configuring the required GitHub secrets and letting the workflow run against real Render and Daytona services.

## Context and Orientation

The repository uses Bun and GitHub Actions. `RELEASING.md` documents release operations. `.github/workflows/db-push.yml` applies database schema changes with `bun run db:push`. `apps/sandbox/package.json` has Daytona build commands named `daytona:build:staging` and `daytona:build:prod`. `apps/web/package.json` has live verification commands, including `test:e2e:cli:live`.

Render is the deployment target for Next.js web, worker, and MCP services. The service definitions live in `render.yaml`. The relevant service names are `cmdclaw-web-staging`, `cmdclaw-worker-staging`, `cmdclaw-mcp-staging`, `cmdclaw-web-prod`, `cmdclaw-worker-prod`, and `cmdclaw-mcp-prod`.

## Plan of Work

Create `scripts/release/render-deploy.ts` as a small Bun script that talks to the Render API. It must support finding the previous successful deploy, deploying a commit, waiting for deploy completion, and rolling back to a deploy ID.

Create `apps/web/scripts/release-replay.ts` and a package script `test:replay:release`. This command reads replay fixtures from `apps/web/tests/release-replay/conversations.json` or `RELEASE_REPLAY_FILE` and runs each command from the repository root. Seed the default fixture file with a chat conversation replay and a coworker builder workflow replay by invoking existing live Vitest files.

Create reusable workflows under `.github/workflows/`: `daytona-sandbox.yml`, `render-deploy.yml`, `render-rollback.yml`, and `verify-deployment.yml`.

Create `.github/workflows/release-main.yml` to orchestrate the full release: resolve commit, stage DB, stage Daytona, stage Render, verify staging, prod DB, prod Daytona, prod Render, verify prod, rollback Render if prod verification fails, and tag success.

Update `RELEASING.md` so operators understand that tags are release history markers, not release triggers.

## Concrete Steps

From the repository root, run:

    bun run worktree:status

Then validate the edited TypeScript:

    bunx tsc --noEmit --allowImportingTsExtensions --moduleResolution bundler --module esnext --target es2022 scripts/release/render-deploy.ts apps/web/scripts/release-replay.ts

Validate the full repo where feasible:

    bun run check

This command completed successfully with 12 Turbo tasks passing. The workflow itself requires GitHub secrets and Render/Daytona credentials, so end-to-end deployment validation happens by pushing to `main` after secrets are configured.

## Validation and Acceptance

The TypeScript helper scripts must typecheck. The release workflow should be visible in GitHub Actions as `Release Main`. On a push to `main`, it should deploy staging first and stop before production if staging verification fails. On production verification failure after production Render deploy, it should run `rollback-prod-render` and roll Render services back to the captured previous deploy IDs. On success, it should push an annotated tag matching `vYYYY.M.D` or `vYYYY.M.D-N`.

## Idempotence and Recovery

Render deploy by commit is safe to retry. If a deploy fails, the workflow exits non-zero. Render rollback reuses a previous deploy artifact. Database schema changes are not automatically reversed; releases should use forward-compatible migration patterns so previous code can run after new additive schema changes.

If a Daytona snapshot build fails, rerun the workflow after fixing credentials or Daytona availability. The Daytona build scripts replace existing stable snapshot names, so the environment continues using `cmdclaw-agent-staging` or `cmdclaw-agent-prod`. The GitHub workflow intentionally does not pass snapshot name override secrets.

## Artifacts and Notes

New workflow files:

    .github/workflows/release-main.yml
    .github/workflows/daytona-sandbox.yml
    .github/workflows/render-deploy.yml
    .github/workflows/render-rollback.yml
    .github/workflows/verify-deployment.yml

New scripts:

    scripts/release/render-deploy.ts
    apps/web/scripts/release-replay.ts
    apps/web/tests/release-replay/conversations.json

Updated docs:

    RELEASING.md

## Interfaces and Dependencies

`scripts/release/render-deploy.ts` exposes these command forms:

    bun scripts/release/render-deploy.ts previous-success --service-id <render-service-id>
    bun scripts/release/render-deploy.ts deploy --service-id <render-service-id> --commit <git-sha>
    bun scripts/release/render-deploy.ts rollback --service-id <render-service-id> --deploy-id <render-deploy-id>
    bun scripts/release/render-deploy.ts wait --service-id <render-service-id> --deploy-id <render-deploy-id>

It requires `RENDER_API_KEY`.

`apps/web/scripts/release-replay.ts` reads JSON shaped like:

    {
      "cases": [
        {
          "name": "short descriptive name",
          "command": ["bun", "run", "cmdclaw", "--", "chat", "--message", "hello", "--no-validate"]
        }
      ]
    }

The release workflow requires the secrets listed in `RELEASING.md`.
