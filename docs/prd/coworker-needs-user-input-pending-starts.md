# PRD: Coworker Pending Starts For User Input

## Problem Statement

Some coworkers cannot safely start from an automated trigger alone because they need task-specific context from a User first. For example, a coworker that drafts a test email needs the recipient address before it should do any work. Today a coworker trigger immediately creates a running coworker run and starts a Generation with the trigger payload, which forces users to encode every required parameter inside automation payloads or coworker instructions.

The user wants coworkers to support a flexible, free-text first human reply before execution. This reply should feel like a normal chat interaction with the coworker runner, appear in the inbox as "Needs your input", and become trusted `userInput` in the coworker run payload when the Generation starts.

## Solution

Bap will add a coworker setting that requires user input before execution. When enabled and no trusted Bap-owned user input is already present, any trigger creates a **Pending Start** instead of starting a **Generation**. A Pending Start creates a coworker run with status `needs_user_input`, creates a coworker conversation, and writes a coworker-authored assistant-style message containing the configured **User Input Prompt**. No model or sandbox work starts yet.

The User answers through the normal chat prompt area. The first non-empty reply, or a reply with attachments, starts the existing pending coworker run. The started Generation receives model input built from the current coworker instructions, the original trigger payload, and trusted `userInput`. The visible coworker question remains conversation history, but is intentionally excluded from model context. This decision is recorded in ADR 0004.

The coworker builder can enable or disable the requirement and generate the User Input Prompt. The normal coworker editor also exposes the setting and prompt so users can inspect and adjust it directly.

## User Stories

1. As a User, I want a coworker to ask me for missing context before it starts, so that it does not run with incomplete parameters.
2. As a User, I want the coworker question to appear as a normal coworker runner message, so that the interaction feels like chat rather than a form.
3. As a User, I want to answer the coworker through the normal prompt area, so that I do not need to learn a special reply UI.
4. As a User, I want the first reply to start the coworker immediately, so that answering the question is enough to continue.
5. As a User, I want the same conversation to stream the coworker's work after I answer, so that the question, answer, and result stay together.
6. As a User, I want scheduled coworkers that need input to appear in my inbox, so that automation can wait for my details without disappearing.
7. As a User, I want webhook-triggered coworkers that need input to appear in my inbox, so that external events can wait for human context.
8. As a User, I want email-forwarded coworkers that need input to appear in my inbox, so that forwarded work can wait for missing details.
9. As a User, I want externally triggered coworkers that need input to appear in my inbox, so that automated work can wait for my instruction.
10. As a User, I want manual "Run now" on a coworker that needs input to open the pending conversation, so that I can answer the coworker directly.
11. As a User, I want multiple trigger events to create multiple pending starts, so that no event is silently lost.
12. As a User, I want existing Pending Starts to remain available when a coworker is turned off, so that already-routed work is not invalidated.
13. As a User, I want turning a coworker off to prevent new automated Pending Starts, so that disabling automation still works.
14. As a User, I want the inbox status to say "Needs your input", so that the action required is clear.
15. As a User, I want a Pending Start to be dismissible, so that I can abandon one trigger event without affecting future triggers.
16. As a User, I want marking a Pending Start as read to be separate from dismissing it, so that I can hide it temporarily without cancelling it.
17. As a User, I want a Pending Start to stay answerable after being marked read, so that I can come back later.
18. As a User, I want Pending Starts to have no automatic expiry, so that work is not lost unexpectedly.
19. As a User, I want the coworker builder to generate the User Input Prompt, so that the question matches the coworker's purpose.
20. As a User, I want the coworker builder to turn user input requirements on and off, so that the builder remains the main way to shape coworkers.
21. As a User, I want the normal coworker editor to show the user input requirement, so that the setting is not hidden.
22. As a User, I want the normal coworker editor to let me edit the User Input Prompt, so that I can fix awkward builder wording.
23. As a User, I want the prompt text preserved when I turn the requirement off, so that I can re-enable it later without recreating the question.
24. As a User, I want validation to block requiring user input without a prompt, so that coworkers do not create confusing empty questions.
25. As a User, I want direct inbox coworker composer messages to start immediately, so that typing the input there counts as my answer.
26. As a CLI user, I want `--user-input` to start a coworker immediately, so that scripts can provide the trusted human answer explicitly.
27. As a CLI user, I want invoking a coworker that requires input without `--user-input` to create a Pending Start, so that I can answer it in the web UI.
28. As a developer, I want raw external trigger payload fields not to count as trusted user input, so that webhooks cannot bypass the required human answer.
29. As a developer, I want trusted user input passed separately from raw trigger payload, so that the source of human input is explicit.
30. As a developer, I want the stored coworker run payload to keep the original trigger, user input prompt snapshot, and user input, so that diagnostics explain what happened.
31. As a developer, I want model input to include trigger context and user input but not the coworker-authored question, so that runtime context stays clean.
32. As a developer, I want Pending Starts to create no model usage, token usage, or billing usage, so that waiting for user input is not counted as execution.
33. As a developer, I want `needs_user_input` runs not to block other pending starts, so that multiple trigger events can wait independently.
34. As a developer, I want active runtime statuses to keep blocking normal runs, so that existing "one active Generation per coworker" safety still applies.
35. As a developer, I want answering a Pending Start to atomically start only if the run is still `needs_user_input`, so that duplicate replies do not create duplicate Generations.
36. As a developer, I want first reply wins on concurrent answers, so that the pending run remains the source of truth.
37. As a developer, I want Pending Starts represented as coworker runs, so that existing run history, routes, and inbox concepts stay aligned.
38. As a developer, I want a pending coworker run to have no `generationId` until the user replies, so that no Generation is implied before work starts.
39. As a developer, I want a separate start-pending-run service path, so that execution can attach to an existing pending run instead of duplicating it.
40. As a developer, I want chat submission to route to pending-run start when a conversation has a `needs_user_input` run, so that the frontend can stay normal.
41. As a developer, I want future messages after the first reply to use normal continuation behavior, so that only the pending start reply is special.
42. As a developer, I want file attachments on the user reply to start the coworker even with empty text, so that upload-first workflows work.
43. As a developer, I want trigger-provided attachments preserved through Pending Start, so that requiring input does not drop event files.
44. As a developer, I want user reply attachments included in the initial Generation, so that the coworker can process files supplied with the answer.
45. As a developer, I want coworker exports to include the user input requirement and prompt, so that shared definitions preserve behavior.
46. As a developer, I want coworker imports to restore the user input requirement and prompt, so that imported coworkers behave as designed.
47. As a developer, I want shared coworker copies to preserve the user input requirement and prompt, so that sharing does not remove the start behavior.
48. As a support engineer, I want Pending Starts visible in run history, so that I can understand why a coworker has not executed yet.
49. As a support engineer, I want cancelled Pending Starts to remain in history, so that dismissed trigger events are auditable as product history.
50. As a support engineer, I want the User Input Prompt snapshot stored with the run payload, so that later prompt edits do not rewrite past pending starts.
51. As a support engineer, I want a clear error when a second reply races an already-started Pending Start, so that users understand what happened.
52. As an operator, I want Pending Starts excluded from token and cost metrics, so that usage reports reflect actual Generations only.
53. As an agent building a coworker, I want the builder edit contract to include user input settings, so that I can configure the feature from chat.
54. As an agent running a coworker, I want generated model input to clearly label trusted user input, so that I can use it correctly.
55. As a future developer, I want glossary terms for Start Message, Pending Start, Needs User Input, and User Input Prompt, so that implementation language stays consistent.

## Implementation Decisions

- Add coworker configuration fields for `requiresUserInput` and `userInputPrompt`.
- `requiresUserInput` defaults to false for existing and new coworkers unless set by the builder or editor.
- `userInputPrompt` is plain text, max 1,000 characters.
- Validation requires non-empty `userInputPrompt` only when `requiresUserInput` is true.
- Turning `requiresUserInput` off preserves `userInputPrompt` for future re-enable.
- The coworker builder edit contract can set `requiresUserInput` and `userInputPrompt`.
- The coworker builder can also unset `requiresUserInput`.
- The normal coworker editor exposes a switch and text field for the same settings.
- Add `needs_user_input` to coworker run statuses.
- The user-facing inbox label for `needs_user_input` is "Needs your input".
- A trigger for a coworker with `requiresUserInput` creates a Pending Start when no trusted Bap-owned user input is supplied.
- Pending Starts are represented as coworker run rows with status `needs_user_input`, original `triggerPayload`, no `generationId`, and a linked conversation.
- Pending Starts create a user-facing conversation before any Generation exists.
- The first visible message in that conversation is a coworker-runner-authored assistant-style message containing the `userInputPrompt` snapshot.
- The user answers through the existing chat prompt area.
- The first user reply starts the same pending coworker run.
- The start path updates that run from `needs_user_input` to `running`, attaches the Generation, and preserves the run id.
- The start path must atomically claim the pending run by status so concurrent replies cannot create duplicate Generations.
- The first reply wins; later concurrent attempts receive a clear "already started" style error.
- `needs_user_input` runs do not count as active runtime runs and do not block other Pending Starts.
- Active runtime statuses remain `running`, `awaiting_approval`, `awaiting_auth`, and `paused`.
- Existing Pending Starts remain answerable even if the coworker is later turned off.
- Turning off a coworker prevents new automated triggers from creating Pending Starts.
- Multiple trigger events create multiple Pending Starts. No broad coworker-level dedupe is added for v1.
- Each Pending Start snapshots the original trigger payload and User Input Prompt when it is created.
- When a Pending Start starts, use current coworker instructions/tool settings, plus the pending run's original trigger context and prompt snapshot.
- Direct Bap-owned human input paths can start immediately by providing trusted user input.
- Trusted user input paths are web chat reply to a Pending Start, inbox coworker composer typed by a logged-in User, and authenticated CLI `--user-input`.
- Raw webhook, schedule, email-forwarding, and generic trigger payload fields are not trusted user input, even if they contain a `userInput` property.
- Trusted `userInput` is a separate internal parameter, not read from arbitrary trigger payload.
- Stored `triggerPayload` for an executed user-input run should distinguish the original trigger from trusted user input and the prompt snapshot:

```json
{
  "source": "schedule",
  "trigger": { "source": "schedule", "scheduledFor": "..." },
  "userInputPrompt": "Which recipient should receive the draft?",
  "userInput": "alice@example.com"
}
```

- Model input includes coworker instructions, the original trigger context, and trusted user input.
- Model input does not include the coworker-authored User Input Prompt as prior assistant context.
- The visible conversation keeps the coworker question and user reply for transcript/share/export purposes.
- The hidden or separated model input payload is not shown in normal transcript export.
- If implementation requires persisted model input, it should be internal/hidden or otherwise separated from visible conversation history.
- Pending Starts create no Generation, no sandbox, no model usage, no token usage, and no billing usage.
- When a User replies, normal Generation usage starts and is billed/measured normally.
- File attachments on a user reply count as valid input even if text is empty.
- Trigger attachments and reply attachments should be preserved and included when the Generation starts.
- `Dismiss` cancels a `needs_user_input` run by marking it `cancelled` and setting `finishedAt`.
- `Mark as read` only updates inbox read state and does not cancel or start the pending run.
- The existing stop/cancel backend behavior should support `needs_user_input` runs with no Generation by cancelling the run; inbox can label that action as Dismiss.
- No automatic expiry is added for Pending Starts in v1.
- `Run now` on a coworker requiring user input creates a Pending Start and opens the conversation.
- Manual web paths with a typed message can provide trusted user input and start immediately.
- CLI adds canonical `--user-input` for trusted user input.
- CLI without `--user-input` on a coworker requiring user input creates a Pending Start and prints identifiers or URL enough for the User to answer in the web UI.
- Export/import/shared-copy payloads include `requiresUserInput` and `userInputPrompt`; Pending Starts themselves are runtime state and are not exported.
- Linear issue text should use the ready-for-agent triage role/status because the behavior and implementation decisions are specified.
- Major modules to build or modify:
  - Coworker schema and status model.
  - Coworker trigger service that creates either immediate runs or Pending Starts.
  - Pending-run start service that claims a `needs_user_input` run and starts its Generation.
  - Coworker builder edit contract and runtime prompt instructions.
  - Coworker editor configuration UI.
  - Inbox query, filters, item rendering, and Dismiss handling for `needs_user_input`.
  - Chat submission routing so a reply in a pending conversation starts the pending run.
  - CLI coworker invocation parser and output for `--user-input`.
  - Coworker export/import/shared-copy schemas.
  - Billing/usage queries so Pending Starts do not count before a Generation exists.

## Testing Decisions

- Tests should verify external behavior and state transitions, not duplicate internal branching logic.
- Good tests assert durable records, user-visible statuses, API responses, generated payload shape, and routing outcomes.
- Coworker trigger service tests should cover immediate start versus Pending Start creation based on `requiresUserInput` and trusted user input.
- Pending-run start service tests should cover successful first reply, file-only reply, concurrent first-reply race, already-started error, turned-off coworker behavior, and payload composition.
- Builder edit tests should cover enabling/disabling `requiresUserInput`, validation of required `userInputPrompt`, prompt length validation, and generated context returned to the builder.
- Editor/router tests should cover create/update/export/import/shared-copy preserving `requiresUserInput` and `userInputPrompt`.
- Inbox router tests should cover listing `needs_user_input` items, filtering by the new status, mark-as-read without cancellation, and Dismiss cancellation.
- Inbox component tests should cover the "Needs your input" label and action availability for `needs_user_input` items.
- Chat/generation router tests should cover conversation submit routing to pending-run start when a linked run has `needs_user_input`.
- Chat UI tests should verify the normal prompt area can answer the pending conversation and no special reply component is required.
- CLI parser tests should cover `--user-input`, compatibility with existing coworker invocation behavior, and no accidental trust of raw trigger payload fields.
- Attachment tests should cover trigger attachments surviving Pending Start and user reply attachments being included when the Generation starts.
- Billing/usage tests should prove `needs_user_input` runs do not emit token/model/billing usage before a Generation exists.
- Run history tests should cover `needs_user_input` run visibility, cancelled pending run history, and no `generationId` before reply.
- Prior art exists in coworker router tests, inbox router tests, generation manager tests, coworker builder service tests, CLI parsing tests, and coworker live/CLI tests.
- After implementation, run targeted tests for the touched modules and `bun run check`.
- Because this crosses schema and runtime behavior, run broader coworker and inbox test suites before considering the PRD complete.
- If the database schema changes, use `bun run --cwd packages/db db:push` for the local app schema update, per app instructions.

## Out of Scope

- Multi-turn clarification before the coworker starts.
- Structured parameter forms for required user input.
- Trusting arbitrary external payload fields as `userInput`.
- Automatically expiring Pending Starts.
- Dedupe across repeated scheduled or webhook Pending Starts.
- Rewriting old Pending Starts when the coworker configuration changes.
- Showing raw trigger JSON in the visible pending conversation by default.
- Counting Pending Starts as usage before a Generation exists.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly from the agent.
- Exporting runtime Pending Starts as part of coworker definition export.

## Further Notes

- Domain terms are recorded in `CONTEXT.md`: **Start Message**, **Pending Start**, **Needs User Input**, and **User Input Prompt**.
- ADR 0004 records the decision to create visible Pending Start conversations before a Generation exists while excluding the coworker-authored question from model context.
- Suggested Linear title: `Coworkers: add Needs your input pending starts`.
- Suggested Linear team: `cmdlaw`.
- Suggested Linear label/status: `ready-for-agent`.
- The implementation should avoid broad compatibility fallbacks. Existing coworkers default to `requiresUserInput = false`, and the new behavior should be explicit.
