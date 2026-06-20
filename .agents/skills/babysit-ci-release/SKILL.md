---
name: babysit-ci-release
description: Continuously watch and fix release main CI until the branch is fully green and verified working. Use when asked to babysit CI, babysit CI release, monitor release main, run /loop for CI, run /goal until checks pass, or keep iterating until release main is green.
---

# Babysit CI Release

## Trigger

Release main CI needs active supervision until every required check is green and the release branch is working.

## Quick start

1. Start a `/goal` for the exact outcome: release main is fully green and working.
2. Create or reuse one focused release-fix branch and one PR targeting `main`; do not iterate directly on `main`.
3. Use `/loop` to keep checking, diagnosing, fixing, pushing to that PR branch, and re-checking until that goal is achieved.
4. Treat the CI status as incomplete until all required PR checks are successful and any release-main smoke or verification command has passed.

## Workflow

1. Identify the release main branch or PR and its required checks.
2. If there is no active PR for the release fix, create one focused branch from the latest `origin/main`, apply fixes there, and open a draft PR.
3. Run the current CI status command, usually `gh pr checks` for the PR.
4. If checks are still running, wait and re-check inside the loop.
5. If a check fails, inspect the failing job logs and extract the first actionable root error.
6. Apply the smallest focused fix on the PR branch, following the repo's normal test and lint policy.
7. Run the relevant local verification for the touched area.
8. Push the PR branch, then continue the `/loop`.
9. Stop only when the PR is fully green and the working verification is complete.

## Direct-main repair

If fixes were accidentally pushed directly to `main`, repair the state before continuing:

1. Revert the direct `main` fix commits with normal revert commits; do not reset published history unless the user explicitly asks.
2. Create a fresh PR branch from the reverted `origin/main`.
3. Reapply all intended fixes into that single PR branch.
4. Continue watching only the PR checks.

## Legacy branch-only loop

Use this only when the user explicitly asks to operate directly on a release branch instead of through a PR:

1. Run the current CI status command for the branch.
2. If checks are still running, wait and re-check inside the loop.
3. If a check fails, inspect the failing job logs and extract the first actionable root error.
4. Apply the smallest focused fix, following the repo's normal test and lint policy.
5. Run the relevant local verification for the touched area.
6. Push the fix when needed, then continue the `/loop`.
7. Stop only when release main is fully green and the working verification is complete.

## Guardrails

- Keep the `/goal` active until the green-and-working condition is actually met.
- Do not stop after a single fix if CI is still pending, red, cancelled, or missing required checks.
- Keep all related fixes in one PR unless the user asks for separate PRs.
- Do not push iterative fixes directly to `main`; push the release-fix PR branch instead.
- Prefer one clear failure and one focused fix per iteration.
- Re-run the exact failed command or check after each fix whenever possible.
- Escalate only when blocked by credentials, unavailable external services, or a decision that cannot be made safely.
- If you lack enough access or need a human to intervene, stop the `/goal` or `/loop` and request human intervention with the exact unlock needed.
- Do not change lint rules or CI policy without explicit user approval.

## Output

- Current `/goal` status
- Current `/loop` iteration and CI state
- PR branch and PR URL
- Failing check, root error, and fix applied
- Local verification commands run
- Human intervention needed, if access or external action blocks progress
- Final PR and release main status when fully green and working
