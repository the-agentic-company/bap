# QA Report: {APP_NAME}

| Field | Value |
| --- | --- |
| Date | {DATE} |
| URL | {URL} |
| Branch | {BRANCH} |
| Commit | {COMMIT_SHA} |
| PR | {PR_NUMBER_OR_URL} |
| Tier | Quick / Standard / Exhaustive |
| Scope | {SCOPE} |
| Duration | {DURATION} |
| Pages visited | {COUNT} |
| Screenshots | {COUNT} |
| Framework | {DETECTED_OR_UNKNOWN} |

## Health Score: {SCORE}/100

| Category | Score |
| --- | --- |
| Console | {0-100} |
| Links | {0-100} |
| Visual | {0-100} |
| Functional | {0-100} |
| UX | {0-100} |
| Performance | {0-100} |
| Accessibility | {0-100} |

## Top 3 Things to Fix

1. ISSUE-001: {title} - {one-line description}
2. ISSUE-002: {title} - {one-line description}
3. ISSUE-003: {title} - {one-line description}

## Console Health

| Error | Count | First seen |
| --- | --- | --- |
| {error message} | {N} | {URL} |

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Total | 0 |

## Issues

### ISSUE-001: {Short title}

| Field | Value |
| --- | --- |
| Severity | critical / high / medium / low |
| Category | visual / functional / ux / content / performance / console / accessibility |
| URL | {page URL} |

Description: {What is wrong, expected versus actual behavior.}

Repro steps:

1. Navigate to {URL}.
2. {Action}.
3. Observe {what goes wrong}.

Evidence:

- Screenshot: {screenshots/issue-001-result.png}
- Console/network notes: {notes}

## Fixes Applied

| Issue | Fix Status | Commit | Files Changed |
| --- | --- | --- | --- |
| ISSUE-NNN | verified / best-effort / reverted / deferred | {SHA_OR_NONE} | {files} |

## Before/After Evidence

### ISSUE-NNN: {title}

- Before: {screenshots/issue-NNN-before.png}
- After: {screenshots/issue-NNN-after.png}

## Regression Tests

| Issue | Test File | Status | Description |
| --- | --- | --- | --- |
| ISSUE-NNN | {path/to/test} | added / deferred / skipped | {description} |

## Deferred Tests

### ISSUE-NNN: {title}

- Precondition: {setup state that triggers the bug}
- Action: {what the user does}
- Expected: {correct behavior}
- Why deferred: {reason}

## Ship Readiness

| Metric | Value |
| --- | --- |
| Health score | {before} to {after} ({delta}) |
| Issues found | {N} |
| Fixes applied | {N} verified, {N} best-effort, {N} reverted |
| Deferred | {N} |

PR Summary: "QA found N issues, fixed M, health score X to Y."

## Regression Against Baseline

| Metric | Baseline | Current | Delta |
| --- | --- | --- | --- |
| Health score | {N} | {N} | {+/-N} |
| Issues | {N} | {N} | {+/-N} |

Fixed since baseline: {list}

New since baseline: {list}
