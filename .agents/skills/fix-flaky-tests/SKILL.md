---
name: fix-flaky-tests
description: Fix flaky tests by repeatedly running the suite, collecting intermittent failures, and proving stability. Use when asked to fix flaky tests or require repeated/consecutive green test runs.
---

# Fix Flaky Tests

Use a goal. Run the relevant test suite 20 times, log every intermittent failure, fix root causes, and reset the green counter after each failure or code change.

Do not stop until all observed flakes are fixed and the suite has passed 5 consecutive full runs.
