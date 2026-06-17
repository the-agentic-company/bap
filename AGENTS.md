# Repository Agents Guide

This repository is organized into several top-level folders. Each folder can have its own `AGENTS.md` with specific guidance for work in that area.

## Top-Level Structure
- `apps/` - Deployable runtimes, including `apps/web` and `apps/worker`.
- `apple/` - macOS and iOS SwiftUI applications.
- `packages/` - Shared workspace packages such as config, core, and db.
- `infra/` - Infrastructure and deployment - Infrastructure as Code.
- `skills/` - Skills for Bap agent to use.
- `docs/` - Repository documentation. Check these docs when working in the related area:
  - `docs/observability.md` - Observability and telemetry guidance.
  - `docs/testing.md` - Testing guidance and expectations.
  - `docs/worktree.md` - Worktree workflow guidance.

## Remarks
- For any work inside a folder, check that folder for its own `AGENTS.md` and follow those instructions.

## Testing

- try to colocated tests with the code they test when relevant. for collacting use this format `*.test.ts` or `*.e2e.test.ts`
- After fixing an error with a CLI tool, alawys verify by rerunning the given command and continue until the underlyisng issue is fix and command start working as expected

## Lint policy
- Every lint setting modification requires explicit user approval.
- Do not change lint rules or lint configuration without explicit user approval, if you think this would lead to an imporvement in the codebase surface it to the user (teach him).

## Commit policy
use the commit skill

## Agent skills

### Issue tracker

Issues are tracked in Linear under team `cmdlaw`; agents prepare issue text only and do not create or update Linear issues directly. See `docs/agents/issue-tracker.md`.

### Triage labels

Use Linear-native labels and statuses that best match the five canonical triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.

if the port 3000 is not available, look with tmux as the server might be running there.