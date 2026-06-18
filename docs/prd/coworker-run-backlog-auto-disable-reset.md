# PRD: Coworker Run Backlog Auto-Disable And Reset

## Problem Statement

Users can get blocked from starting a new **Coworker Run** because Bap currently treats waiting runs as active conflicts. A run that is waiting for approval, authentication, a continuation, or a **Start Message** is not actively doing work, but it can still cause a new Run Now attempt to fail with "Coworker already has an active run." This is especially frustrating when the user is intentionally trying to recover by starting a fresh run.

At the same time, fully removing the guard would let external automated triggers create unbounded waiting runs. A coworker that repeatedly needs human attention could accumulate many pending runs and make the runs UI noisy while continuing to accept automated triggers indefinitely.

## Solution

Bap will separate user-intent starts from external automated triggers.

Manual Run Now and **Runtime-Originated Runs** through the **Bap MCP Server** are user-intent starts. They are blocked only by an actively `running` **Coworker Run**. Waiting runs such as `needs_user_input`, `awaiting_approval`, `awaiting_auth`, and `paused` become **Coworker Run Backlog** and do not block user-intent starts.

External automated triggers remain guarded. If a coworker already has five backlog runs, the next external trigger auto-disables the coworker before creating another run. The coworker records why it was auto-disabled and the UI gives the user a clear bulk recovery path: **Reset and enable**. The reset marks all non-terminal runs for that coworker as `cancelling`, requests cancellation for linked Generations, enables the coworker optimistically, and lets runtime cancellation or maintenance settle runs to terminal `cancelled`.

## User Stories

1. As a User, I want Run Now to work when previous runs are waiting for input, so that I can start fresh without clearing every old run first.
2. As a User, I want Run Now to stay blocked when a coworker is actively running, so that I do not accidentally start two concurrent executions for the same coworker.
3. As a User, I want approval-waiting runs not to block Run Now, so that an old approval request does not stop new work.
4. As a User, I want authentication-waiting runs not to block Run Now, so that a disconnected integration prompt does not stop new work.
5. As a User, I want paused continuation runs not to block Run Now, so that a previous runtime-deadline pause does not trap the coworker.
6. As a User, I want pending starts that need a Start Message not to block Run Now, so that old unanswered trigger events do not stop manual work.
7. As a User, I want Bap MCP coworker starts to behave like Run Now, so that an agent acting for me can start a coworker even when backlog exists.
8. As a User, I want external automated triggers to stop when too many runs need attention, so that automation does not create endless backlog.
9. As a User, I want the coworker to say why automation was paused, so that I understand what happened.
10. As a User, I want a clear recovery button, so that I do not need to open and cancel five runs manually.
11. As a User, I want reset to enable the coworker optimistically, so that I am not left waiting on runtime cleanup.
12. As a User, I want reset to show a confirmation, so that I know I am discarding previous waiting or running work.
13. As a User, I want cancelling runs to show as "Cancelling", so that I can see reset is in progress.
14. As a User, I want cancelling runs not to block new starts, so that optimistic reset actually unblocks me.
15. As a User, I want cancelling runs not to count toward the automated-trigger cap, so that reset does not immediately auto-disable the coworker again.
16. As a User, I want to review runs before resetting, so that I can inspect what will be discarded.
17. As a User, I want Run Now to remain available on an auto-disabled coworker, so that auto-disable only pauses automation.
18. As a User, I want normal manually-off coworkers to stay visually distinct from auto-disabled coworkers, so that recovery language only appears when relevant.
19. As a User, I want normal enable to explain when backlog must be reset first, so that I know how to resume automation.
20. As a workspace User, I want to reset a coworker I can run, so that recovery is not limited to the owner or an admin.
21. As a workspace User, I want reset actions recorded with my user identity, so that destructive recovery is auditable.
22. As an operator, I want scheduled trigger jobs that auto-disable a coworker to be acknowledged, so that the queue does not retry a deliberate skip.
23. As an operator, I want Gmail, forwarded email, X DM, and webhook triggers to use the same backlog cap, so that all external automation is bounded consistently.
24. As an operator, I want no synthetic skipped run row when auto-disable happens, so that run history does not gain another confusing state.
25. As a developer, I want start classification to be explicit, so that guard behavior is not inferred from fragile trigger payload conventions.
26. As a developer, I want user-intent starts and external triggers to share one policy module, so that the guard is easy to test and reason about.
27. As a developer, I want `cancelling` to exist only at the Coworker Run layer, so that Generation cancellation can keep using existing cancellation-request mechanics.
28. As a developer, I want reset to request cancellation for linked non-terminal Generations, so that old runtime work is eventually stopped.
29. As a developer, I want reset to directly cancel pending starts with no linked Generation, so that they do not wait for a runtime that does not exist.
30. As a developer, I want maintenance to settle stuck cancelling rows, so that parked or detached Generations do not remain cancelling forever.
31. As a developer, I want stale run reconciliation to respect cancelling runs, so that they are not treated as active conflicts.
32. As a developer, I want SLO and run-history queries to treat `cancelling` as non-terminal, so that terminal reporting remains accurate.
33. As a developer, I want terminal `cancelled` to remain the final state, so that existing completion semantics stay clear.
34. As a support engineer, I want auto-disabled metadata visible in run/coworker diagnostics, so that I can explain why automation stopped.
35. As a support engineer, I want reset events on affected runs, so that run history explains why they moved to cancelling or cancelled.
36. As a future developer, I want the backlog cap decision recorded in docs, so that nobody reintroduces broad active-run blocking by accident.

## Implementation Decisions

- Add an explicit coworker start classification, such as `user_intent` and `external_trigger`.
- Direct Run Now starts are `user_intent`.
- **Runtime-Originated Runs** through the **Bap MCP Server** are `user_intent` because they carry user intent.
- Scheduled, Gmail, forwarded email, X DM, webhook, and other external automation starts are `external_trigger`.
- `user_intent` starts can run a coworker whose status is off, including an **Auto-Disabled Coworker**.
- `external_trigger` starts require the coworker to be on.
- All start classifications are still blocked by an existing `running` **Coworker Run** for the same coworker.
- **Coworker Run Backlog** statuses are `needs_user_input`, `awaiting_approval`, `awaiting_auth`, and `paused`.
- Backlog statuses do not block `user_intent` starts.
- Backlog statuses count toward the external-trigger cap.
- The external-trigger cap is five backlog runs per coworker.
- The cap is enforced before creating a new pending start or Generation.
- When an external trigger arrives and the coworker already has five backlog runs, Bap auto-disables the coworker and creates no new run.
- Auto-disable is recorded on the coworker with explicit disable metadata, including a reason such as `run_backlog_limit` and a timestamp.
- Auto-disable should not create a synthetic skipped **Coworker Run** row.
- Queue jobs that cause auto-disable are acknowledged as handled skips rather than retried failures.
- Add `cancelling` to **Coworker Run** status.
- `cancelling` is non-terminal.
- `cancelling` does not count toward the external-trigger backlog cap.
- `cancelling` does not block user-intent or external starts.
- Do not add a `cancelling` Generation status; linked Generations keep their existing non-terminal status with cancellation requested until they settle.
- Existing Generation cancellation-request mechanics remain the source of truth for runtime cancellation.
- Add a bulk **Coworker Run Reset** operation.
- **Coworker Run Reset** cancels all non-terminal **Coworker Runs** for the coworker, regardless of origin.
- The reset set includes `needs_user_input`, `running`, `awaiting_approval`, `awaiting_auth`, `paused`, and `cancelling`.
- The reset set excludes terminal `completed`, `error`, and `cancelled` runs.
- Pending starts without linked Generations can be marked `cancelled` immediately during reset.
- Runs with linked non-terminal Generations should move to `cancelling`, have cancellation requested on the Generation, and settle later to terminal `cancelled`.
- Reset is optimistic: it enables the coworker immediately after marking/resetting affected rows, without waiting for runtime teardown.
- Runtime cleanup and parked Generation cancellation can settle asynchronously.
- Background maintenance should finalize cancellation-requested Generations and linked cancelling runs when no active runtime path will settle them.
- Reset records an event on each affected run with the acting user and reset source.
- Any workspace User who can access and run the coworker may perform reset; reset is not limited to owners or admins.
- Reset remains workspace-scoped; users outside the workspace cannot reset the coworker.
- Normal enable remains available for ordinary manually-off coworkers when backlog is below the cap.
- If normal enable would immediately hit the backlog cap, the UI blocks normal enable and offers reset instead.
- The destructive reset UI must use one bulk action, not ask users to cancel runs one by one.
- Recommended recovery copy: "This coworker has 5 runs waiting for input or continuation, so automated triggers were paused."
- Recommended primary action: "Reset and enable".
- Recommended secondary action: "Review runs".
- Recommended confirmation copy: "This will cancel all current waiting or running runs for this coworker and enable automated triggers again. This cannot be undone."
- The coworker list/card/editor surfaces should distinguish user-off from auto-disabled due to backlog.
- The runs UI and inbox should display `cancelling` with a clear "Cancelling" label.
- Cancelling runs should be visible but should not offer approve, auth, continue, or stop actions.
- Deep module opportunity: extract a Coworker Run start policy module that takes start classification, coworker disabled state, active run counts, and backlog counts, then returns `allow`, `block_running`, or `auto_disable_due_to_backlog`.
- Deep module opportunity: extract a Coworker Run reset service that performs authorization, bulk state transition, cancellation request, event recording, and optimistic enable behind one interface.
- Deep module opportunity: extract a coworker disabled-state presenter that converts status, disable metadata, and backlog counts into UI copy/actions.

## Testing Decisions

- Tests should assert external behavior: database-visible state transitions, API outcomes, queue acknowledgement, UI labels/actions, and emitted run events.
- Tests should avoid duplicating implementation branching details of the policy module.
- Start policy tests should cover `user_intent` with no running run, `user_intent` with a running run, `external_trigger` below cap, `external_trigger` at cap, off coworker with user-intent, and off coworker with external trigger.
- Coworker trigger service tests should verify that waiting backlog no longer blocks Run Now.
- Coworker trigger service tests should verify that `running` remains a conflict for every start classification.
- Coworker trigger service tests should verify cap-before-creation for coworkers requiring a **Start Message**.
- Coworker trigger service tests should verify that auto-disable creates no new run row.
- Queue handler tests should verify auto-disable outcomes are acknowledged and logged, not retried.
- Bap MCP/runtime-originated tests should verify those starts bypass the backlog cap while still honoring `running` conflicts and Spawn Depth.
- Reset service tests should verify all non-terminal runs are included regardless of origin.
- Reset service tests should verify terminal runs are not modified.
- Reset service tests should verify pending starts without Generations become terminal `cancelled`.
- Reset service tests should verify linked non-terminal Generations get cancellation requested and linked runs become `cancelling`.
- Reset service tests should verify coworker disable metadata is cleared and status becomes on after reset.
- Reset authorization tests should verify a workspace user who can run the coworker can reset it, while users outside the workspace cannot.
- Maintenance tests should verify cancellation-requested Generations and linked `cancelling` runs eventually settle to `cancelled`.
- UI tests should verify auto-disabled alert copy, Reset and enable, Review runs, Run now, and normal off-state behavior.
- UI tests should verify reset uses a confirmation before destructive bulk cancellation.
- Inbox and run-list tests should verify `cancelling` status labels, filters, colors/icons, and disabled actions.
- CLI/runtime envelope tests should include the new `cancelling` coworker run status where shared types expose statuses.
- SLO/backfill or overview tests should verify `cancelling` is non-terminal and not counted as terminal cancelled until it settles.
- Prior art exists in coworker service tests for active-run guards, queue tests for swallowed active-run conflicts, inbox router tests for run statuses, generation cancellation tests, and coworker UI tests for run lists.
- After implementation, run targeted coworker service, queue, generation, inbox, and coworker UI tests.
- Because this includes schema changes, run the database migration/push workflow expected for local development before validating the app.

## Out of Scope

- Changing Spawn Depth behavior for **Runtime-Originated Runs**.
- Allowing two `running` **Coworker Runs** for the same coworker.
- Creating a synthetic skipped run row for auto-disabled triggers.
- Adding `cancelling` as a Generation status.
- Synchronously waiting for every runtime teardown before re-enabling a coworker.
- Automatically resetting runs without explicit user confirmation.
- Requiring users to open and cancel runs one by one.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly from the agent.
- Reworking approval/auth/continuation flows beyond how they participate in backlog and reset.

## Further Notes

- This PRD follows ADR 0015: **Coworker Run Backlog Does Not Block Run Now**.
- Domain terms are recorded in `CONTEXT.md`: **Coworker Run**, **Coworker Run Backlog**, **Auto-Disabled Coworker**, **Coworker Run Reset**, and **Cancelling Coworker Run**.
- The original observed failure was a user trying to start a new coworker run while an earlier run needed continuation; the old active-run guard treated that waiting run as blocking.
- The intended product model is deliberately simple: user-intent starts only conflict with `running`; external triggers are bounded by backlog cap and auto-disable.
- Suggested Linear title: `Coworkers: auto-disable backlog and reset runs`.
- Suggested Linear team: `cmdlaw`.
- Suggested triage status: ready for implementation.
