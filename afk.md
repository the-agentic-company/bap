# AFK Agent Runs

This file coordinates unattended agent work started from Linear issues.

## Limits

- Maximum parallel agent runs: 5
- Target PRs ready for review: 5

## Rules

Before starting a new Linear issue, count rows in `Agent runs` with status `running`.
If there are 5 or more, do not start another agent run.

Before starting a new Linear issue, count rows in `Agent runs` with status `pr-ready`.
If there are 5 or more, do not start another agent run until a PR leaves review.

When an agent starts, add or update one row with status `running`.
When the work has a PR ready for review, update that row to `pr-ready` and include the PR URL.
When the PR is merged, closed, or no longer needs review, update the status to `done`.

## Agent Runs

| Linear issue | Title | Thread / branch | Status | PR URL | Started at | Updated at |
| --- | --- | --- | --- | --- | --- | --- |
