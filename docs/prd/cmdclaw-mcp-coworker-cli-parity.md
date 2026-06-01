# CmdClaw MCP Coworker CLI Parity

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

CmdClaw's CmdClaw MCP server already exposes some coworker operations, but it does not yet match the latest `bun run cli coworker` surface. Agents using CmdClaw MCP can list, inspect, trigger, and read logs for coworkers, but they cannot create a new coworker through the same deterministic contract as the CLI. The existing `coworker.run` MCP tool also lacks the CLI's trusted `userInput` path, so a coworker that requires a **Start Message** cannot be triggered from MCP with the same immediate-start behavior available from the CLI.

This makes CmdClaw MCP less useful as an agent-facing control surface. Users and agents must fall back to CLI commands or web flows for ordinary coworker setup, and MCP callers can accidentally create **Pending Starts** when they meant to provide the required human context directly.

## Solution

Extend the CmdClaw MCP server so its coworker tools mirror the latest deterministic `bun run cli coworker` behavior for this version. Add a `coworker.create` MCP tool based on the smaller current CLI create schema, and update `coworker.run` to accept structured `userInput` that maps to trusted user input for the coworker trigger.

The CLI remains the ground truth for this version of CmdClaw MCP. The MCP tool shape should preserve CLI semantics while using MCP-native structured values where the CLI uses terminal-friendly scalar flags. In particular, `integrations` should be a string array in MCP, because it maps directly to the CLI's comma-separated integrations flag and the existing coworker create input expects an array.

## User Stories

1. As an MCP client, I want to create a coworker through CmdClaw MCP, so that I can automate coworker setup without shelling out to the CLI.
2. As an MCP client, I want `coworker.create` to use the same required inputs as the latest CLI, so that CLI and MCP behavior stay predictable.
3. As an MCP client, I want `coworker.create` to accept an optional coworker name, so that I can create named coworkers when the workflow needs a user-facing label.
4. As an MCP client, I want `coworker.create` to require a trigger type, so that the created **Coworker** has an explicit trigger contract.
5. As an MCP client, I want `coworker.create` to require coworker instructions, so that the created **Coworker** has enough behavior definition to run.
6. As an MCP client, I want to provide optional "do" guidance, so that I can shape desired coworker behavior without editing later.
7. As an MCP client, I want to provide optional "don't" guidance, so that I can constrain undesired coworker behavior without editing later.
8. As an MCP client, I want to choose the model reference, so that MCP-created coworkers can match CLI-created coworkers.
9. As an MCP client, I want to choose the model auth source, so that the **Coworker** can use the intended model credential source.
10. As an MCP client, I want to choose whether the coworker auto-approves writes, so that write behavior matches the CLI create command.
11. As an MCP client, I want to provide allowed integrations as a structured array, so that agents do not need to serialize comma-separated strings for MCP calls.
12. As an MCP client, I want omitted optional create fields to use the same defaults as the CLI path, so that MCP and CLI-created coworkers do not diverge.
13. As an MCP client, I want the create result to include the new coworker id, name, username, and status, so that I can immediately inspect or trigger the created coworker.
14. As an MCP client, I want `coworker.run` to accept trusted user input, so that coworkers requiring a **Start Message** can start a **Generation** immediately.
15. As an MCP client, I want `coworker.run` without trusted user input to keep existing **Pending Start** behavior, so that MCP does not bypass the user-input requirement accidentally.
16. As an MCP client, I want `coworker.run` to keep accepting coworker id or `@username`, so that existing MCP callers do not lose reference convenience.
17. As an MCP client, I want `coworker.run` to keep accepting a trigger payload, so that existing run automation remains supported.
18. As an MCP client, I want a triggered run result to show whether a **Generation** exists, so that I can tell the difference between an immediate run and a **Pending Start**.
19. As a CLI user, I want CmdClaw MCP to follow the latest CLI command behavior, so that documentation and mental models do not split.
20. As a developer, I want coworker MCP behavior implemented through the existing coworker runner abstraction, so that CLI and MCP stay close to the same client contract.
21. As a developer, I want the CmdClaw MCP handler layer to remain a small testable module, so that tool wrappers stay shallow and behavior tests can focus on input-to-client calls.
22. As a developer, I want MCP tools to reject missing authentication through the existing CmdClaw MCP auth path, so that new coworker write tools keep the same authorization boundary.
23. As a developer, I want `coworker.create` to be explicitly non-read-only and non-idempotent in MCP metadata, so that clients understand it creates durable product state.
24. As a developer, I want `coworker.run` to remain explicitly non-read-only and non-idempotent, so that clients understand it triggers execution.
25. As a support engineer, I want MCP-created coworkers to be ordinary coworkers, so that existing list, get, run, logs, web UI, and run history surfaces work without special cases.
26. As a future developer, I want debug-only CLI flags excluded from the normal MCP contract, so that CmdClaw MCP does not grow operational escape hatches as product API.
27. As a future developer, I want the builder flow excluded from this version, so that deterministic create behavior ships without entangling multi-turn builder runtime behavior.

## Implementation Decisions

- The latest `bun run cli coworker` command group is the ground truth for this CmdClaw MCP slice.
- Add a deterministic `coworker.create` CmdClaw MCP tool.
- Do not expose the conversational coworker builder through this PRD.
- `coworker.create` uses the smaller current CLI create schema, not the full backend create schema.
- `coworker.create` requires `trigger` and `prompt`.
- `coworker.create` keeps `name` optional, matching the current CLI implementation.
- `coworker.create` supports the CLI create options for prompt guidance, auto-approval, model, model auth source, and integrations.
- MCP accepts `integrations` as a structured string array. This preserves the CLI flag's meaning without requiring comma-separated serialization in MCP.
- The handler maps MCP `integrations` to the existing coworker create input's allowed integrations field.
- `coworker.create` uses the same default connected chat model as the CLI when the model is omitted.
- `coworker.create` passes through the model auth source only when provided, leaving existing backend resolution rules in place.
- `coworker.create` returns the existing coworker create result shape: coworker id, name, username, and status, plus any existing stable public fields returned by the client contract.
- `coworker.create` is a write tool in MCP metadata and is not idempotent.
- Update the existing `coworker.run` MCP tool to accept `userInput`.
- `coworker.run` maps MCP `userInput` to trusted user input in the coworker runner.
- `coworker.run` keeps existing `reference`, `payload`, and server URL override behavior.
- `coworker.run` without `userInput` keeps existing behavior. If the coworker requires a **Start Message**, the run may become a **Pending Start**.
- `coworker.run` with non-empty `userInput` should start coworkers that require input immediately, matching the CLI `--user-input` behavior.
- Do not expose debug run deadline or chaos flags through CmdClaw MCP in this PRD. Those are CLI diagnostic controls, not the normal MCP product contract.
- Do not add enable/disable or status mutation tools in this PRD. "Start" in this scope means trigger a coworker run, not turn a coworker on.
- No database schema change is required; this PRD uses existing coworker create and trigger contracts.
- No new ADR is required. The decisions are a small API surface extension, align with the current CLI contract, and do not introduce a surprising hard-to-reverse architecture choice.
- The useful deep module boundary is the CmdClaw MCP coworker handler layer: tool wrappers authenticate and parse MCP input, while handlers call the existing coworker runner with a small stable interface.

## Testing Decisions

- Tests should assert external behavior at the CmdClaw MCP handler and tool-contract boundary. They should not duplicate backend validation logic or reimplement coworker creation rules in test code.
- Add handler tests proving `coworker.create` calls the coworker client create path with the CLI-equivalent fields.
- Add handler tests proving MCP structured `integrations` are mapped to allowed integrations.
- Add handler tests proving omitted optional create fields are not invented by the MCP handler except for the CLI model default where the CLI currently supplies one.
- Add handler tests proving `coworker.run` passes `userInput` as trusted user input.
- Keep the existing handler test that proves `coworker.run` triggers by `@username` reference.
- Add tool wrapper tests if the CmdClaw MCP server already has prior art for wrapper-level tests; otherwise, handler tests are sufficient because wrappers should stay shallow.
- Test auth failure behavior through the existing CmdClaw MCP client creation path only if adding the create tool changes wrapper behavior.
- Use existing CmdClaw MCP handler tests as prior art for list, get, run, and logs.
- Use existing CLI coworker route tests as prior art for the create and run option surface, but do not make MCP tests depend on CLI parser internals.
- Run the focused CmdClaw MCP server tests after implementation.
- Run the MCP package typecheck if cheap for the changed files.
- Do not add browser or UI tests; this PRD does not change frontend behavior.

## Out of Scope

- Exposing the conversational coworker builder as an MCP tool.
- Exposing full backend coworker create fields that are not in the current CLI create command.
- Adding coworker edit, enable, disable, archive, delete, approve, or list-runs MCP tools.
- Changing the existing web coworker create form.
- Changing coworker database schema.
- Changing **Pending Start** semantics.
- Changing **Start Message**, **User Input Prompt**, or inbox behavior.
- Exposing debug run deadline, chaos approval, or other diagnostic CLI flags through MCP.
- Changing lint configuration.
- Creating or updating Linear issues directly.

## Further Notes

The glossary now distinguishes **Start Message** from "trigger a coworker run". This PRD uses "trigger a coworker run" for execution requests and avoids using "start" for enablement or status changes.

The older web script has a stricter create usage string that requires a name, but the latest `bun run cli coworker` implementation does not. For this PRD, the latest CLI command group is authoritative.
