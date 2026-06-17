# PRD: Chat Area Generation Stream Refactor

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

The web chat area has grown into a large module that mixes rendering, composer controls, **Generation** stream orchestration, reconnect behavior, approval and auth handling, queued messages, run-deadline resume behavior, voice input, debug telemetry, Coworker sync side effects, and Agentic-App panel composition. The file is currently far over the target size and is hard to change safely because understanding one chat behavior requires reading many unrelated concerns in one place.

The user wants the chat area reduced below 1000 lines of code, but not by creating shallow pass-through modules. The refactor should deepen the codebase around the actual source of complexity: the **Generation** stream lifecycle. Starting a new **Generation** and reconnecting to an active **Generation** currently have duplicated event handling, and the correctness rules for stale stream events, runtime ownership, approvals, auth completion, cancellation, and run-deadline resume are spread through the chat area.

## Solution

Extract a deep **Generation** stream lifecycle hook and internal implementation modules under a dedicated chat generation-stream area. The chat area should become a shell that composes rendering and high-level controls, while the hook owns runtime refs, current **Generation** identity, stream scope, stale-event rejection, init tracking, start/reconnect adapters, stop/cancel behavior, approval/auth resume behavior, and run-deadline resume state.

The extraction should be a Big Bang rewrite of the duplicated stream lifecycle, not a mechanical file split. Starting a new **Generation** and reconnecting to an active **Generation** should use one shared stream handler path with different adapters. The hook should remain the external seam used by the chat area, but its implementation should be split into smaller internal modules so no new file becomes another giant module.

Persisted message mapping and timing helpers should move into a separate pure module. Coworker-specific sync after Tool Invocation events should be passed into the stream hook as a small adapter so the stream lifecycle does not own Coworker cache policy. Existing broad chat area tests should remain as the main regression net, while focused tests should be added around pure helpers and lifecycle-specific behavior.

## User Stories

1. As a Bap User, I want chat behavior to remain unchanged after the refactor, so that sending messages still works normally.
2. As a Bap User, I want an in-progress **Generation** to keep streaming into the transcript, so that live model output remains visible.
3. As a Bap User, I want an active **Generation** to reconnect correctly after navigation or refresh, so that I do not lose live progress.
4. As a Bap User, I want stale stream events from an old conversation or **Generation** to be ignored, so that the wrong transcript is not updated.
5. As a Bap User, I want approvals to continue appearing and submitting correctly, so that Tool Invocations remain controllable.
6. As a Bap User, I want auth requests to continue appearing and redirecting correctly, so that missing integration authorization can be resolved.
7. As a Bap User, I want returning from OAuth completion to resume the interrupted **Generation**, so that connecting an integration does not leave the chat stuck.
8. As a Bap User, I want cancelling a **Generation** to stop local streaming and backend execution, so that the UI and runtime agree.
9. As a Bap User, I want a completed **Generation** to hydrate the final persisted assistant message, so that attachments and sandbox files appear accurately.
10. As a Bap User, I want visible **Generation** errors to remain understandable, so that I know when a run failed and can retry.
11. As a Bap User, I want run-deadline pauses to continue showing a resume prompt, so that I can continue a paused **Generation** from where it stopped.
12. As a Bap User, I want historical run-deadline activity to remain visible around the "continue" message, so that the transcript tells the full story.
13. As a Bap User, I want queued messages to keep working during an active **Generation**, so that follow-up instructions are not lost.
14. As a Bap User, I want existing model selection, skill selection, auto-approve, voice input, and Agentic-App behavior to keep working, so that the refactor does not remove chat capabilities.
15. As a Bap User, I want Coworker edits performed through chat Tool Invocations to keep refreshing Coworker state, so that the builder stays current.
16. As a Bap developer, I want the chat area module below 1000 lines, so that the main chat shell is navigable.
17. As a Bap developer, I want **Generation** stream lifecycle behavior behind one hook interface, so that callers do not need to know runtime ref ordering rules.
18. As a Bap developer, I want starting and reconnecting a **Generation** to share one handler implementation, so that fixes to stream events are made once.
19. As a Bap developer, I want stale-event rejection to live with stream lifecycle code, so that race conditions are easier to reason about.
20. As a Bap developer, I want runtime ownership to live with stream lifecycle code, so that the chat shell does not manage `GenerationRuntime` refs directly.
21. As a Bap developer, I want init tracking and watchdog telemetry isolated, so that agent init status behavior can be tested and changed locally.
22. As a Bap developer, I want approval and auth resume behavior isolated, so that interactive **Generation** waits are not mixed with rendering.
23. As a Bap developer, I want run-deadline resume helpers isolated, so that paused **Generation** behavior has a clear home.
24. As a Bap developer, I want persisted message mapping to be pure and separately tested, so that transcript hydration has a stable test surface.
25. As a Bap developer, I want Coworker sync to be an adapter passed into the stream lifecycle, so that Coworker cache policy does not leak into generic stream code.
26. As a Bap developer, I want no new file to exceed 1000 lines, so that the refactor does not move the same problem elsewhere.
27. As a Bap developer, I want existing chat area tests preserved during the rewrite, so that regressions are easy to identify.
28. As a Bap developer, I want focused tests on extracted modules, so that behavior can be verified without broad component setup.
29. As a reviewer, I want the refactor to avoid lint configuration changes, so that style policy is not changed to make the rewrite pass.
30. As a reviewer, I want a narrow behavioral diff, so that the refactor can be reviewed as architecture cleanup rather than product redesign.

## Implementation Decisions

- Perform a Big Bang rewrite of the **Generation** stream lifecycle extraction.
- The refactor goal is to reduce the chat area below 1000 lines of code.
- Do not create backward-compatible duplicate stream paths.
- Treat new **Generation** start and active **Generation** reconnect as the same lifecycle with different adapters.
- Add one public hook as the external seam for chat **Generation** stream lifecycle behavior.
- The public hook owns runtime refs, current **Generation** identity, stream scope, stale-event rejection, init tracking, start/reconnect adapters, stop/cancel behavior, approval/auth resume behavior, and run-deadline resume state.
- The chat area should not own `GenerationRuntime` refs directly after the refactor.
- The chat area should not own current **Generation** identity refs directly after the refactor.
- The chat area should not own stream scope or stale-event acceptance rules after the refactor.
- The public hook exposes state and actions needed by the chat shell: messages, streaming parts, display activity segments, streaming state, stream error, agent init status, init elapsed label, debug snapshot, historical run-deadline activity blocks, start/run, stop, approve, deny, connect auth, cancel auth, and segment expansion.
- Split the hook implementation into internal modules rather than creating one large hook file.
- Use a dedicated generation-stream folder under the chat area to keep the cohesive implementation cluster discoverable.
- Include an internal stream handler builder used by both start and reconnect adapters.
- The shared stream handler path owns event acceptance checks, runtime event application, done handling, error handling, and cancelled handling.
- Include an internal init tracker module for agent init status, watchdog timeout, first-signal tracking, missing-init tracking, elapsed labels, and related telemetry.
- Include an internal interrupt module for approval, auth, optimistic resume, local resolution key updates, and run-deadline resume helpers.
- Include a pure message mapping module for persisted-message mapping and timing enrichment helpers.
- Include a Coworker stream sync adapter builder or adapter type so Coworker-specific invalidation and result parsing stay outside the generic stream lifecycle.
- The stream hook may call the Coworker adapter on **Generation** start, system events, Tool Invocation start, Tool Invocation result, and lifecycle cleanup.
- The stream hook should not parse Coworker edit tool results itself once the adapter exists.
- The stream hook owns message hydration after **Generation** completion because final hydration is part of completing the lifecycle.
- Pure persisted-message mapping stays outside the stream hook because it is transcript data plumbing.
- Approval and auth action handlers belong inside the stream hook because they mutate runtime state, submit oRPC mutations, optimistically resume interrupted **Generations**, and affect stream status.
- Run-deadline resume state belongs inside the stream hook because a run-deadline pause is a **Generation** lifecycle state.
- The transcript/rendering split is a follow-up candidate, not part of the first mandatory seam unless needed to reach the line target.
- Queued-message extraction is a follow-up candidate unless needed to reach the line target.
- Composer control extraction is a follow-up candidate unless needed to reach the line target.
- Voice input extraction is a follow-up candidate unless needed to reach the line target.
- Do not create an ADR for this refactor; the module structure is reversible and not a hard platform decision.
- Do not update the domain glossary for this refactor; no new product/domain term was introduced.
- Preserve existing user-facing chat behavior.
- Preserve existing route behavior and OAuth completion behavior.
- Preserve existing Agentic-App panel behavior.
- Preserve existing queued message behavior.
- Preserve existing Coworker sync behavior by moving it behind an adapter, not by deleting it.
- Preserve existing debug popover behavior and admin-only visibility.
- Do not change lint rules or lint configuration.
- Do not commit as part of implementation unless explicitly asked.

## Testing Decisions

- Preserve the existing broad chat area test as the main regression net for the first rewrite.
- Do not aggressively move broad UI tests during the same rewrite.
- Add focused tests only where extraction creates pure or near-pure modules.
- A good test should assert external behavior at the module interface, not private ref names or implementation ordering.
- Add tests for persisted message mapping, including text parts, thinking parts, Tool Invocation parts, approvals, Coworker invocation parts, attachments, sandbox files, and timing helpers.
- Add tests for run-deadline resume helpers, including synthetic approval segment creation, historical activity block creation, and hydrated activity from persisted content parts.
- Add tests for interrupt helpers, including locally resolved approval filtering, optimistic approval resume, optimistic auth resume, and removing resolved interrupt state.
- Add tests for the shared stream handler path where practical, especially stale event rejection, done hydration, error handling, and cancelled handling.
- Add tests that prove start and reconnect adapters use the same stream event handling behavior.
- Add tests that prove auth completion resumes an interrupted **Generation** when the runtime is present and when it is not present.
- Add tests that prove approval and deny handlers submit the expected decisions and update local runtime state.
- Add tests that prove run-deadline resume starts a "continue" **Generation** with the paused **Generation** id.
- Add tests that prove Coworker sync is invoked through the adapter for relevant Tool Invocation events.
- Keep component-level chat area tests focused on user-visible behavior after the extraction.
- Prior art includes existing chat area tests for chat behavior, activity feed tests for runtime activity display, approval segment filter tests for approval dedupe behavior, auth request card tests, tool approval card tests, and chat message sync tests.
- Required verification should include the focused tests touched by the refactor.
- Required verification should include `bun run check`.
- After fixing any failing CLI verification, rerun the command until the underlying issue is fixed and the command works as expected.

## Out of Scope

- Changing the product behavior of chat.
- Changing **Generation** backend semantics.
- Replacing SSE, Redis, oRPC, or the existing **Generation** runtime.
- Changing queued message backend behavior.
- Changing approval or auth product flows.
- Changing Agentic-App prompt behavior.
- Changing model selection semantics.
- Changing skill selection semantics.
- Redesigning the chat UI.
- Moving the entire transcript rendering system unless needed to meet the line target after the stream lifecycle extraction.
- Moving every small helper solely for line count if it creates shallow modules.
- Adding new environment variables.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly.
- Creating an ADR for this refactor.
- Updating `CONTEXT.md` for implementation-only terms.

## Further Notes

- The agreed primary seam is the **Generation** stream lifecycle hook.
- The agreed implementation should be a Big Bang rewrite of the duplicated start/reconnect stream path.
- The agreed internal file targets are all below 1000 lines.
- The chat area should remain the shell/composition module after the refactor.
- The first implementation should preserve the existing broad chat area test and add focused tests for extracted helpers.
- Follow-up deepening opportunities after this PRD include transcript/activity rendering extraction, queued-message extraction, composer controls extraction, and voice input extraction.
