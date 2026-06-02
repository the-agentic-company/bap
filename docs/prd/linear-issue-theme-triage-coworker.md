# Linear Issue Theme Triage Coworker

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

The User is the solo worker in the `cmdlaw` Linear team and wants a fast way to review the full issue queue, understand repeated themes, and see triage groupings in Slack without manually scanning Linear. Today that work requires opening Linear, reading issues one by one, and mentally clustering related requests, bugs, and operational follow-ups.

The User wants a **Coworker** that reviews every relevant Linear issue, triages them, groups common themes, and posts the digest to Slack channel `#ops-testing`.

## User-Facing Solution

Create a manual **Coworker** named `Linear Issue Theme Triage` with access to only Linear and Slack. When triggered, the coworker queries the full `cmdlaw` Linear team issue queue, reviews all non-archived issues it can access, clusters them into common themes, assigns each issue to a practical triage group, and posts a structured Slack digest to `#ops-testing`.

The digest should be optimized for quick review. It should include a short executive summary, theme groups with representative issues, suggested triage status or label guidance, and a final list of issues that need missing information or human judgment.

## User Stories

1. As the User, I want the coworker to inspect every issue in the `cmdlaw` Linear team, so that the digest reflects the whole queue rather than an assignee subset.
2. As the User, I want the coworker to include open and backlog-like work, so that unresolved work is grouped together.
3. As the User, I want the coworker to ignore archived or completed issues unless Linear's available query surface cannot filter them cleanly, so that old closed work does not dominate the digest.
4. As the User, I want issues grouped into common themes, so that I can see repeated product and engineering patterns.
5. As the User, I want each theme to show representative Linear identifiers and titles, so that I can jump back into Linear quickly.
6. As the User, I want the coworker to call out the largest themes first, so that the highest-volume concern is visible at the top.
7. As the User, I want suggested triage guidance for each group, so that I can decide what is `ready-for-agent`, `needs-info`, `ready-for-human`, or not worth actioning.
8. As the User, I want a separate "needs clarification" section, so that ambiguous or underspecified issues do not get buried.
9. As the User, I want the coworker to identify duplicates or near-duplicates, so that I can consolidate repeated issues.
10. As the User, I want the coworker to identify issues that appear blocked by missing integrations, credentials, product decisions, or external state, so that I do not waste agent cycles on them.
11. As the User, I want the coworker to distinguish bugs, feature requests, maintenance work, operational incidents, and documentation work when possible, so that themes are actionable rather than vague.
12. As the User, I want the Slack post in `#ops-testing`, so that the initial version is visible in a safe testing channel.
13. As the User, I want one Slack message by default, so that I have a compact digest rather than a noisy stream.
14. As the User, I want the digest to mention when Linear pagination or access limits may have hidden issues, so that I can trust the scope caveats.
15. As the User, I want the coworker to avoid changing Linear issues, labels, statuses, assignees, or comments, so that the first version is read-only on Linear.
16. As the User, I want the coworker to post only after it has finished the analysis, so that Slack receives a coherent result.
17. As the User, I want the coworker to include a timestamp and issue count, so that I can compare digests over time.
18. As the User, I want the coworker to keep sensitive issue content concise, so that Slack gets enough context without copying large issue descriptions.
19. As a developer, I want the coworker definition to use existing Linear and Slack **Integration Type** access, so that no custom integration code is needed.
20. As a developer, I want the coworker to be manual-triggered for the initial version, so that schedule tuning is not part of the first delivery.
21. As a developer, I want the coworker instructions to be deterministic enough for the CLI create path, so that the coworker can be created without relying on a multi-turn builder conversation.
22. As a support engineer, I want the coworker to report failures in the run transcript if Linear or Slack access is unavailable, so that setup problems are diagnosable.

## Implementation Decisions

- The coworker is a normal **Coworker** created through the deterministic coworker creation path, not a one-off chat.
- Name: `Linear Issue Theme Triage`.
- Trigger type: `manual`.
- Allowed integrations: `linear` and `slack` only.
- Slack destination: `#ops-testing`.
- Linear scope: every issue in the `cmdlaw` Linear team that the connected Linear account can access.
- The User is the solo worker in the team, but the coworker must still query by team rather than by assignee.
- The coworker must not modify Linear in the initial version. It can read issues and prepare suggested triage guidance only.
- The coworker may write to Slack by posting the final digest.
- The coworker should use Linear-native issue identifiers and URLs when available.
- The coworker should group issues by observed theme, not only by existing Linear label.
- The coworker should include an "Unclear or needs info" group when issues are too ambiguous to triage confidently.
- Suggested triage guidance should map to this repo's canonical triage roles through Linear-native labels/statuses: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`.
- The digest format should be stable:
  - Title with timestamp and total issue count.
  - Scope caveat if pagination, permissions, or filters were incomplete.
  - Top themes sorted by issue count.
  - For each theme: short description, suggested triage guidance, representative issues, and next action.
  - Duplicates or near-duplicates.
  - Needs clarification.
  - Suggested next review actions.
- The coworker should keep Slack output compact enough for one message when possible. If the Slack tool rejects the message for length, the coworker may post a shorter summary and include the top issues per theme.
- No ADR is required. This is a coworker definition using existing **Integration Type** behavior and does not change architecture.

## Testing Decisions

- Verify the coworker can be created through the deterministic coworker CLI or equivalent product path with `linear` and `slack` as the only allowed integrations.
- Verify the created coworker details show the intended name, trigger type, prompt, and allowed integrations.
- Trigger a run only if Linear and Slack connected access is available in the current environment.
- If a live run is possible, verify the coworker posts to `#ops-testing` and the digest includes issue count, top themes, suggested triage guidance, and scope caveats when applicable.
- If a live run is not possible, verify the coworker instructions are stored correctly and report the blocked live verification reason.
- Do not add mocks for Linear or Slack behavior just to test the coworker instructions. This work is mainly configuration and prompt behavior.
- Run focused checks for any changed source files if the implementation adds code or template catalog entries.
- Do not change lint rules or lint configuration.

## Out of Scope

- Automatically changing Linear labels, statuses, assignees, comments, priorities, cycles, or projects.
- Creating or updating Linear issues directly.
- Posting to production Slack channels other than `#ops-testing`.
- Scheduled or recurring runs.
- Multiple Slack messages or threads by default.
- New custom Linear API code.
- New custom Slack API code.
- UI redesign for coworkers or templates.
- New database schema.
- New ADR.

## Further Notes

The initial coworker is intentionally manual. A future version can add a schedule once the User likes the grouping format and Slack channel behavior.

If the implementation cannot create a live coworker because the local app server, auth, Linear access, or Slack access is unavailable, it should still leave a reusable coworker definition or template artifact and report the precise blocker.
