---
name: qa
description: Systematically QA a web application like a real user, triage issues by severity, fix scoped bugs when asked, verify fixes with evidence, and report ship readiness. Use when asked to QA, test a site or app, find bugs, test and fix, or check whether a feature works.
---

# QA

Act as both a QA engineer and, when the user wants fixes, a bug-fix engineer. Test the application through real user workflows, record evidence, triage findings, apply focused source-code fixes, and re-verify.

## Setup

Start by identifying:

- Target URL or local app entry point
- Scope: full app, changed branch, specific page, feature, or workflow
- Tier: quick, standard, or exhaustive
- Mode: report-only, test-and-fix, or regression against a prior report
- Authentication needs and available test accounts or browser sessions
- Output location for screenshots and the QA report

For local web UI QA in Codex, use the Codex native in-app Browser first. If the user says the in-app browser is open, or the target is `localhost`, `127.0.0.1`, `::1`, or a `file://` URL, control that browser directly for navigation, screenshots, clicks, typing, console inspection, and network inspection. Do not create temporary Playwright, Selenium, TypeScript, JavaScript, or `.mjs` driver files for browser testing in this case.

Only fall back to a custom browser automation script when the Codex native Browser tool is genuinely unavailable after checking the available tools/skills. If you fall back, state the reason before creating any files and keep all temporary artifacts out of the app source tree.

If no URL is provided and the worktree is on a feature branch, prefer diff-aware QA: inspect changed files, infer the affected routes and flows, then test those areas first before broader smoke coverage.

Respect the repo's working-tree and commit policy. Do not commit unless the user explicitly asks. If fixes are requested, avoid overwriting unrelated user changes.

## Tiers

- Quick: focus on critical and high severity issues.
- Standard: include critical, high, and medium issues.
- Exhaustive: include low severity and cosmetic polish issues as well.

The selected tier controls which issues get fixed during test-and-fix mode. Always report lower-priority findings that were intentionally deferred.

## Baseline QA

Explore the app like a user, not like a DOM inspector. For each relevant page or workflow:

- Capture the starting state with a screenshot.
- Click every visible button, link, menu, tab, and control that belongs to the scope.
- Fill forms with valid data, empty submissions, invalid data, long values, and special characters when relevant.
- Check navigation paths in and out, including back/forward behavior, deep links, mobile navigation, and dead ends.
- Exercise loading, empty, error, full, and overflow states when they are reachable.
- Watch console errors and failed network requests after each interaction.
- Check responsive behavior on mobile and desktop when the UI is user-facing.
- Check auth boundaries when roles, logged-out states, or permission gates matter.

Record the baseline health score before applying fixes. Use the same scoring rubric for final QA so before/after comparisons are meaningful.

## Issue Taxonomy

Use [references/issue-taxonomy.md](references/issue-taxonomy.md) for severity definitions, category examples, and the per-page exploration checklist.

## Triage

Sort findings by severity and user impact. Mark each issue as:

- Fix now: in tier, source-controllable, and safe to change.
- Deferred: out of tier, blocked by missing access, outside source control, third-party, infrastructure-dependent, or too risky for the current scope.
- Needs user decision: requires product judgment or a tradeoff that cannot be inferred from the codebase.

Prefer fixing issues that affect core workflows before visual polish.

## Fix Loop

For each fixable issue, work one issue at a time:

1. Locate the source responsible for the observed behavior.
2. Understand the surrounding code and existing patterns before editing.
3. Apply the smallest change that fixes the issue.
4. Avoid unrelated refactors, opportunistic cleanup, and broad rewrites.
5. Re-test the exact repro path.
6. Capture before/after evidence when visual or behavioral evidence is useful.
7. Check for new console errors or obvious regressions.
8. Classify the result as verified, best-effort, reverted, or deferred.

If a fix makes the application worse, revert only that fix and mark the issue deferred with evidence.

## Regression Tests

Add a regression test when the fix is behavioral and the repo has an appropriate test seam. Skip test creation for purely visual CSS fixes unless the project already has reliable visual or component coverage.

Before adding a test:

- Read nearby tests and match the repo's naming, setup, imports, and assertion style.
- Trace the bug's real code path from user action or input to failure.
- Test the precondition that triggered the bug, the action that exposed it, and the behavior that should now hold.
- Prefer tests that exercise the actual implementation over tests that duplicate implementation logic.

If no good test seam exists, say that explicitly in the report and explain what architecture or harness is missing.

## Self-Regulation

Pause and ask the user before continuing when:

- Several fixes have required broad or unrelated file changes.
- A fix was reverted.
- The remaining issues are mostly low severity.
- You are approaching a large number of fixes.
- The QA pass is turning into product redesign rather than bug fixing.

Keep the blast radius small. A QA pass should increase confidence, not produce a hard-to-review bundle of unrelated changes.

## Final QA

After fixes, re-run the affected workflows and any broader smoke paths that could have regressed. Compute a final health score using the same categories as the baseline.

If the final score is worse than the baseline, call that out clearly and explain what regressed.

## Report

Produce a concise QA report. Use [templates/qa-report-template.md](templates/qa-report-template.md) when a structured artifact is useful.

Every report should include:

- Date, target, branch or commit when relevant, tier, scope, duration, pages visited, and screenshots captured.
- Baseline and final health scores.
- Top issues to fix.
- Console and network health summary.
- Issue list with severity, category, URL, description, expected versus actual behavior, and repro steps.
- Fix status for each issue: verified, best-effort, reverted, or deferred.
- Files changed and tests added when fixes were made.
- Before/after screenshots for fixed UI issues.
- Deferred issues and why they were deferred.
- Ship-readiness summary.
- One-line PR summary: "QA found N issues, fixed M, health score X to Y."

If the repo has a `TODOS.md`, add newly deferred bugs there only when that matches existing repo practice. If a fixed issue was already listed, annotate it rather than creating a duplicate.
