---
name: babysit-ci-release
description: Continuously watch and fix release main CI until the branch is fully green and verified working. Use when asked to babysit CI, babysit CI release, monitor release main, run /loop for CI, run /goal until checks pass, or keep iterating until release main is green.
---

# Babysit CI Release

## Trigger

Release main CI needs active supervision until every required check is green and the release branch is working.

## Quick start

1. Start a `/goal` for the exact outcome: release main is fully green and working.
2. Use `/loop` to keep checking, diagnosing, fixing, pushing, and re-checking until that goal is achieved.
3. Treat the CI status as incomplete until all required checks are successful and any release-main smoke or verification command has passed.

## Workflow

1. Identify the release main branch or PR and its required checks.
2. Run the current CI status command, usually `gh pr checks` for a PR or the release workflow/status command for the branch.
3. If checks are still running, wait and re-check inside the loop.
4. If a check fails, inspect the failing job logs and extract the first actionable root error.
5. Apply the smallest focused fix, following the repo's normal test and lint policy.
6. Run the relevant local verification for the touched area.
7. Push the fix when needed, then continue the `/loop`.
8. Stop only when release main is fully green and the working verification is complete.

## Guardrails

- Keep the `/goal` active until the green-and-working condition is actually met.
- Do not stop after a single fix if CI is still pending, red, cancelled, or missing required checks.
- Prefer one clear failure and one focused fix per iteration.
- Re-run the exact failed command or check after each fix whenever possible.
- Escalate only when blocked by credentials, unavailable external services, or a decision that cannot be made safely.
- If you lack enough access or need a human to intervene, stop the `/goal` or `/loop` and request human intervention with the exact unlock needed.
- Do not change lint rules or CI policy without explicit user approval.

## Output

- Current `/goal` status
- Current `/loop` iteration and CI state
- Failing check, root error, and fix applied
- Local verification commands run
- Human intervention needed, if access or external action blocks progress
- Final release main status when fully green and working
