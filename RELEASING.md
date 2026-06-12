# Releasing

CmdClaw ships from `main`.

Every push to `main` starts the `Release Main` workflow. The workflow deploys the
same commit to staging, verifies staging, promotes that commit to production,
verifies production, and creates a production release tag only after production
verification succeeds.

## Release Flow

The automatic workflow is `.github/workflows/release-main.yml`.

For each release it:

- resolves the pushed commit and verifies it is on `main`
- resumes the staging Render resources that are normally suspended for cost
  control
- pushes database schema changes to staging
- builds the Daytona staging snapshot
- deploys staging Render services from the commit SHA
- checks staging health, runs CLI live checks, and runs release replay fixtures
- suspends staging Render resources again, even when staging deploy or
  verification fails
- pushes database schema changes to production
- builds the Daytona production snapshot
- deploys production Render services from the same commit SHA
- checks production health, runs CLI live checks, and runs release replay fixtures
- creates an annotated production tag, using the existing release format:
  `vYYYY.M.D` for the first release of the day, then `vYYYY.M.D-2`,
  `vYYYY.M.D-3`, and so on for later releases that same day

Production is not triggered by manually creating a tag. Tags are release history
markers created by the successful workflow.

Accepted production release tags match:

```text
^v\d{4}\.\d{1,2}\.\d{1,2}(-\d+)?$
```

## Rollback

Render rollback is handled by `.github/workflows/render-rollback.yml`.

If production verification fails after the production Render deploy completed,
the main release workflow automatically rolls web, worker, and MCP services back
to the previous successful Render deploy IDs captured before the production
deploy.

Database changes are not automatically rolled back. Release migrations should be
safe for the previous application version to run against. Prefer additive
database changes first, deploy code second, and remove old columns or tables in a
later release after the old code path is gone.

Daytona snapshots use stable environment names:

- staging: `bap-agent-staging`
- production: `bap-agent-prod`

Rebuilding the previous commit can restore the previous snapshot contents if a
Daytona rollback is needed.

## Replay Fixtures

The verification workflow runs:

```bash
bun run --cwd apps/web test:e2e:cli:live
bun run --cwd apps/web test:replay:release
```

`test:replay:release` reads replay cases from
`apps/web/tests/release-replay/conversations.json` by default, or from the path
in `RELEASE_REPLAY_FILE`.

Replay cases are command arrays that run from the repository root. This keeps
historical conversation or workflow replays explicit and reviewable.

## Required GitHub Secrets

Set these secrets on each GitHub environment named `staging` and `prod` before
enabling the workflow:

- `RENDER_API_KEY`
- `DAYTONA_API_KEY`, or both `DAYTONA_JWT_TOKEN` and `DAYTONA_ORGANIZATION_ID`
- `DAYTONA_API_URL` if the default Daytona API URL is not correct
- `DATABASE_URL_STAGING`
- `DATABASE_URL_PROD`
- `RELEASE_ALERT_WEBHOOK_URL` for optional failure alerts

Render service IDs are resolved at runtime from stable service names. The release
workflow expects these names to exist:

- staging: `bap-web-staging`, `bap-worker-staging`, `bap-mcp-staging`
- prod: `bap-web-prod`, `bap-worker-prod`, `bap-mcp-prod`

Stateful infrastructure such as `bap-zero-cache-staging` and
`bap-zero-cache-prod` is managed by the Render blueprint rather than the
per-commit deploy workflow because it uses a pinned prebuilt image.

Staging is intentionally on-demand. The `staging-resume` job starts every
staging Render resource listed in `scripts/release/render-staging-lifecycle.ts`
before migrations and deployment. The `staging-suspend` job runs with
`always()` after staging verification and turns those resources back off, so a
failed release does not leave staging billing all month.

Deployment configuration is tracked in `render.yaml`, and service runtime
secrets should come from the Render environment groups described there.
