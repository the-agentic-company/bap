# Fix Bastion High Security Issues

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan instructions from `/Users/baptiste/Git/cmdclaw/.agents/skills/execplan/SKILL.md`.

## Purpose / Big Picture

The Bastion report dated 2026-05-22 identifies high-criticality security findings in this repository. Most findings are GitHub Actions shell-injection findings: a workflow `run:` step embeds a GitHub expression such as `${{ inputs.ref }}` directly inside shell code, so a malicious input could become part of the shell script before Bash starts. One finding is a committed bcrypt password hash in the local Daytona Dex configuration. After this work, workflow inputs will be passed into shell steps through explicit `env:` variables and referenced as quoted shell variables, and the Dex password hash will no longer be stored in the committed config file.

The result is observable by searching the changed workflows for direct `${{ ... }}` interpolation inside `run:` scripts, running workflow syntax checks where available, and verifying that the local Daytona compose profile renders a Dex config from an environment-provided hash instead of a committed bcrypt value.

## Progress

- [x] (2026-05-22T19:35:32Z) Read the Bastion report from `/Users/baptiste/Downloads/bastion-high-code-security-issues.md`.
- [x] (2026-05-22T19:35:32Z) Ran `bun run worktree:status` from `/Users/baptiste/Git/cmdclaw`; the repository is not currently in a worktree.
- [x] (2026-05-22T19:35:32Z) Inspected the affected workflow and Docker compose files and confirmed there are no nested `AGENTS.md` files under `.github` or `docker`.
- [x] (2026-05-22T19:35:32Z) Created this self-contained execution plan.
- [x] (2026-05-22T19:45:00Z) Replaced direct GitHub expression interpolation inside affected `run:` steps with intermediate environment variables.
- [x] (2026-05-22T19:53:00Z) Also hardened `.github/workflows/release-main.yml`, which had the same direct shell interpolation pattern and was clean by the final implementation pass.
- [x] (2026-05-22T19:45:00Z) Removed the committed Daytona Dex bcrypt hash and render the Dex config from `DAYTONA_DEX_PASSWORD_HASH` at container startup.
- [x] (2026-05-22T19:49:00Z) Ran targeted validation and updated this plan with results.

## Surprises & Discoveries

- Observation: `.github/workflows/release-main.yml` already has unrelated local modifications before this task.
  Evidence: `git status --short` reported `M .github/workflows/release-main.yml`, and `git diff -- .github/workflows/release-main.yml` showed observability deployment gating edits.

- Observation: A repository-wide search found additional direct GitHub expressions inside `run:` steps in `.github/workflows/release-main.yml`.
  Evidence: `rg -n '\$\{\{[^}]+\}\}' .github/workflows/*.yml` reported `release-main.yml` shell script lines such as `if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then`.

- Observation: By the final implementation pass, `.github/workflows/release-main.yml` no longer had unrelated local modifications, so it could be safely hardened with the same env-var pattern.
  Evidence: `git diff -- .github/workflows/release-main.yml` returned no output before the security edit to that file.

- Observation: `bunx actionlint` does not provide a runnable executable for the package name `actionlint` in this environment.
  Evidence: `bunx actionlint ...` exited with `error: could not determine executable to run for package actionlint`.

- Observation: Compose variable interpolation must not splice a bcrypt hash directly into the `entrypoint` command, because bcrypt hashes contain dollar signs that a shell would treat as parameter expansion.
  Evidence: The validated `docker compose ... --profile daytona config` output keeps the entrypoint command as `$${DAYTONA_DEX_PASSWORD_HASH}` and passes the hash separately through service `environment`.

## Decision Log

- Decision: Start with the 19 Bastion findings and same-file equivalent findings in the affected reusable workflows, then include `.github/workflows/release-main.yml` once it was safe to edit.
  Rationale: The user asked to fix the reported issues, and `release-main.yml` initially had unrelated pre-existing local changes. After that file became clean, fixing the same direct shell interpolation pattern reduced the chance that a broader SAST rerun would reopen the same class of issue elsewhere.
  Date/Author: 2026-05-22 / Codex

- Decision: Use workflow `env:` mappings for untrusted workflow inputs, then reference quoted Bash variables inside `run:` scripts and one-line commands.
  Rationale: This matches the Bastion remediation guidance and prevents GitHub expression values from being spliced directly into the generated shell script.
  Date/Author: 2026-05-22 / Codex

- Decision: Remove the committed Dex bcrypt hash from `docker/compose/daytona/dex/config.yaml` and generate `/tmp/dex-config.yaml` inside the `daytona-dex` container using a required `DAYTONA_DEX_PASSWORD_HASH` environment variable.
  Rationale: The committed hash is credential material. Runtime templating keeps local development possible without relying on Dex-specific config expansion behavior.
  Date/Author: 2026-05-22 / Codex

- Decision: Keep `DAYTONA_DEX_PASSWORD_HASH` optional at Docker Compose interpolation time and enforce it inside the `daytona-dex` container entrypoint.
  Rationale: Requiring the variable in the Compose YAML with `${VAR:?message}` would make unrelated `docker compose -f docker/compose/dev.yml config` calls fail even when the `daytona` profile is not being started. Enforcing it in the entrypoint preserves default compose workflows and still fails clearly when the Dex service actually starts.
  Date/Author: 2026-05-22 / Codex

- Decision: Use `go run github.com/rhysd/actionlint/cmd/actionlint@latest ...` for workflow validation.
  Rationale: `bunx actionlint` failed to find an executable, while the Go module provides the official `actionlint` binary and completed successfully against the changed workflow files.
  Date/Author: 2026-05-22 / Codex

## Outcomes & Retrospective

Implemented the Bastion remediation for the 18 reported GitHub Actions shell-injection findings by moving untrusted workflow inputs into step `env:` mappings before the shell reads them. Also hardened the same direct shell interpolation pattern in `.github/workflows/release-main.yml` once it was safe to edit. Removed the committed Daytona Dex bcrypt hash from `docker/compose/daytona/dex/config.yaml`, documented local hash generation, and changed the `daytona-dex` compose service to render a temporary config at startup.

Validation passed with `git diff --check`, a targeted `awk` search for direct `${{ inputs.* }}`, `${{ github.* }}`, or `${{ needs.* }}` interpolation inside workflow `run:` steps, default compose rendering, Daytona-profile compose rendering with a throwaway hash, a Dex config bcrypt search, and `actionlint` via `go run`.

## Context and Orientation

GitHub Actions workflow files live under `.github/workflows/`. A `run:` step is a shell command or shell script executed by a GitHub-hosted runner. GitHub expressions such as `${{ inputs.environment }}` are evaluated by GitHub before the shell script is written. If the expression contains attacker-controlled text and is embedded directly into the shell script, the shell can interpret it as code. The safer pattern is to copy the expression into a step `env:` variable and then read the shell variable, for example `ENVIRONMENT: ${{ inputs.environment }}` followed by `case "${ENVIRONMENT}" in`.

The affected workflow files are `.github/workflows/verify-observability.yml`, `.github/workflows/db-push.yml`, `.github/workflows/render-rollback.yml`, `.github/workflows/render-deploy.yml`, `.github/workflows/verify-deployment.yml`, `.github/workflows/render-observability-deploy.yml`, `.github/workflows/daytona-sandbox.yml`, `.github/workflows/e2b-sandbox.yml`, `.github/workflows/staging-deploy.yml`, `.github/workflows/create-release-tag.yml`, `.github/workflows/prod-release.yml`, and `.github/workflows/release-main.yml`.

The Daytona Dex configuration is `docker/compose/daytona/dex/config.yaml`, and the compose service that mounts it is `daytona-dex` in `docker/compose/dev.yml`. Dex is the local OpenID Connect identity provider used by the Daytona self-hosted development profile. The committed config currently contains a bcrypt hash for a documented local password. A bcrypt hash is not plaintext, but it is still reusable credential material and can be brute-forced or copied, so the committed value must be removed.

## Plan of Work

First, update each affected GitHub Actions step so every `run:` command that consumes a workflow input or GitHub context gets that value through `env:`. For multi-line Bash scripts, add step-local env variables such as `ENVIRONMENT`, `COMMIT_SHA`, `REF`, `BASE_URL`, `WEB_DEPLOY_ID`, `WORKER_DEPLOY_ID`, `MCP_DEPLOY_ID`, `EVENT_NAME`, `BEFORE`, `HEAD`, `SERVER_URL`, `REPOSITORY`, or `RUN_ID`, and then replace `${{ inputs.* }}`, `${{ github.* }}`, or `${{ needs.* }}` in the shell script with the corresponding quoted shell variable. For one-line deploy commands, add `env:` and pass `--commit "${COMMIT_SHA}"` or `--deploy-id "${WEB_DEPLOY_ID}"`. For sandbox build scripts that currently build a script name with `${{ inputs.environment }}`, switch to a Bash `case` statement on `ENVIRONMENT` and call the literal script name for `dev`, `staging`, or `prod`.

Second, remove the bcrypt hash from `docker/compose/daytona/dex/config.yaml` by replacing it with a placeholder such as `__DAYTONA_DEX_PASSWORD_HASH__`. Update the `daytona-dex` service in `docker/compose/dev.yml` to require `DAYTONA_DEX_PASSWORD_HASH` and to render a temporary config with `sed` before starting Dex. Update `docker/compose/daytona/README.md` so local developers know to generate a fresh hash and set `DAYTONA_DEX_PASSWORD_HASH` in their repo-root `.env`.

Third, validate the changes. Run a text search that fails if direct `${{ inputs.* }}` interpolation remains inside the affected `run:` sections. Run `docker compose --env-file .env -f docker/compose/dev.yml config` without a Dex hash to ensure the non-Daytona compose path still renders. Run `docker compose --env-file .env -f docker/compose/dev.yml --profile daytona config` with a throwaway `DAYTONA_DEX_PASSWORD_HASH` value in the command environment to ensure the Daytona profile still renders. Run `actionlint` through `go run github.com/rhysd/actionlint/cmd/actionlint@latest` against the changed workflow files. Finally, run `git diff --check` to catch whitespace problems.

## Concrete Steps

Work from `/Users/baptiste/Git/cmdclaw`.

Edit the workflow files listed in Context and Orientation. For each edited shell step, use this pattern:

    env:
      ENVIRONMENT: ${{ inputs.environment }}
    shell: bash
    run: |
      set -euo pipefail
      case "${ENVIRONMENT}" in
        staging | prod)
          ...
          ;;
      esac

Edit the Daytona files:

    docker/compose/daytona/dex/config.yaml
    docker/compose/dev.yml
    docker/compose/daytona/README.md

Then run:

    cd /Users/baptiste/Git/cmdclaw
    git diff --check
    docker compose --env-file .env -f docker/compose/dev.yml config >/tmp/cmdclaw-compose-default.yml
    DAYTONA_DEX_PASSWORD_HASH='compose-config-placeholder-not-a-bcrypt-hash' docker compose --env-file .env -f docker/compose/dev.yml --profile daytona config >/tmp/cmdclaw-daytona-compose.yml
    go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/verify-observability.yml .github/workflows/db-push.yml .github/workflows/render-rollback.yml .github/workflows/render-deploy.yml .github/workflows/verify-deployment.yml .github/workflows/render-observability-deploy.yml .github/workflows/daytona-sandbox.yml .github/workflows/e2b-sandbox.yml .github/workflows/staging-deploy.yml .github/workflows/create-release-tag.yml .github/workflows/prod-release.yml .github/workflows/release-main.yml

If the compose command fails because local `.env` is missing unrelated variables, rerun with the minimum required environment values documented by the error and record the failure in `Surprises & Discoveries`.

## Validation and Acceptance

Acceptance for the shell-injection findings is that the affected `run:` steps no longer contain direct `${{ inputs.* }}`, `${{ github.* }}`, or `${{ needs.* }}` interpolation. Inputs are still used in workflow metadata, `with:` values, `if:` expressions, and `env:` mappings because those contexts are not shell scripts. For example, `.github/workflows/staging-deploy.yml` should still be allowed to use `ref: ${{ inputs.ref }}` in `actions/checkout`, but the Bash script should use `REF` when calling `git rev-parse`.

Acceptance for the Dex finding is that `docker/compose/daytona/dex/config.yaml` no longer contains a bcrypt hash. A text search for `'$2a$'`, `'$2b$'`, or `'$2y$'` in that file should return no matches. The README should tell developers how to generate and set a new local hash, and the compose service should fail clearly if `DAYTONA_DEX_PASSWORD_HASH` is not set.

Validation commands should complete successfully or have documented environmental reasons if they cannot run locally. `git diff --check` must pass.

Validation completed on 2026-05-22:

    $ git diff --check
    # passed with no output

    $ <targeted awk search for direct inputs/github/needs interpolation inside workflow run blocks>
    # passed with no output

    $ docker compose --env-file .env -f docker/compose/dev.yml config >/tmp/cmdclaw-compose-default.yml
    # passed with no output

    $ DAYTONA_DEX_PASSWORD_HASH='compose-config-placeholder-not-a-bcrypt-hash' docker compose --env-file .env -f docker/compose/dev.yml --profile daytona config >/tmp/cmdclaw-daytona-compose.yml
    # passed with no output

    $ rg -n '\$2[aby]\$' docker/compose/daytona/dex/config.yaml
    # exited 1 with no matches, which is expected

    $ go run github.com/rhysd/actionlint/cmd/actionlint@latest <changed workflow files including release-main.yml>
    # passed with no output

## Idempotence and Recovery

The workflow edits are idempotent: applying the pattern more than once should not change behavior beyond variable naming. The Docker compose change is also idempotent because it renders `/tmp/dex-config.yaml` on container start instead of modifying the repository file. If the Dex service fails to start after this change, set `DAYTONA_DEX_PASSWORD_HASH` in `.env` to a freshly generated bcrypt hash and restart the compose profile.

Do not commit in this task unless the user explicitly asks. The root repository instructions require `scripts/committer "<msg>" <file...>` for commits, but this plan only changes files and validates them.

## Artifacts and Notes

Initial worktree status:

    $ bun run worktree:status
    [worktree] you are not in a worktree

Initial dirty file:

    $ git status --short
     M .github/workflows/release-main.yml

## Interfaces and Dependencies

No TypeScript interfaces or application runtime APIs are changed by this plan. The workflow interface remains the same: existing workflow inputs keep their names and meanings. The local Daytona compose interface gains one required environment variable for the `daytona-dex` service:

    DAYTONA_DEX_PASSWORD_HASH

This value must be a bcrypt hash accepted by Dex in `staticPasswords[].hash`. Developers can generate it with an external bcrypt-capable tool and place it in the repo-root `.env` file used by the compose command.

Revision note 2026-05-22 / Codex: Initial plan created from the Bastion report and local repository inspection so the implementation can proceed with a self-contained security remediation path.

Revision note 2026-05-22 / Codex: Updated after implementation to record completed workflow hardening, Dex hash externalization, validation commands, the decision to enforce `DAYTONA_DEX_PASSWORD_HASH` at container startup instead of Compose interpolation time, and the later inclusion of `.github/workflows/release-main.yml` once that file was clean.
