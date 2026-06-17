# PRD: Coworker Router Deep Module Refactor

## Problem Statement

The Coworker oRPC router and its test file have grown into large, multi-responsibility files. They currently mix transport wiring, authorization, read-model aggregation, write workflows, import/export behavior, **Coworker History** normalization, **Coworker Forwarding Alias** lifecycle, **Coworker Builder Conversation** creation, and run views in one place.

This makes the Coworker surface harder to change safely. A developer working on one concept must understand unrelated concepts, and tests for focused behavior are coupled to a large router fixture. The immediate goal is to reduce both the main Coworker router and its router test file below 1000 lines each, but the deeper goal is better locality and leverage: each Coworker concept should sit behind a small, stable, testable module interface.

## Solution

Refactor the Coworker router as a Big Bang module split. The router should become transport wiring: schemas, active workspace authorization where appropriate, and delegation to deep modules. Product behavior should remain unchanged.

The implementation will introduce focused modules for **Coworker History**, **Coworker Definition**, **Coworker Builder Conversation**, **Coworker Forwarding Alias**, Coworker run views, Coworker catalog read models, Coworker profile writes, Coworker triggering, Toolbox resolution, Builder metadata backfill, admin views, and impersonation target lookups.

Detailed behavior tests should move out of the router test and into colocated module tests. The router test should keep thin coverage for transport-level behavior, procedure wiring, and delegation edge cases.

## User Stories

1. As a developer, I want the Coworker router to stay under 1000 lines, so that I can navigate it without carrying unrelated Coworker concepts in my head.
2. As a developer, I want the Coworker router test file to stay under 1000 lines, so that router tests remain focused on transport behavior.
3. As a developer, I want **Coworker History** behavior behind one module interface, so that event payload interpretation changes in one place.
4. As a developer, I want **Coworker History** tests to call the same interface the router calls, so that tests verify the real seam.
5. As a User, I want **Coworker History** entries to keep their current status, target, preview, and ordering behavior, so that the refactor does not change the product experience.
6. As a support engineer, I want **Coworker History** to continue reconciling stale runs before showing statuses, so that pending and error states stay current.
7. As a developer, I want **Coworker Definition** import and export behind one module interface, so that versioned format rules are easy to reason about.
8. As a User, I want exported **Coworker Definitions** to keep including Coworker settings, **Toolbox**, **Coworker Documents**, and generated artifacts, so that existing export workflows keep working.
9. As a User, I want imported **Coworker Definitions** to start off, so that importing does not unexpectedly enable automation.
10. As a developer, I want shared Coworker import handled with **Coworker Definition** rules, so that copying a Coworker and importing serialized Coworkers have consistent behavior.
11. As a developer, I want imported artifacts restored through the **Coworker Definition** module, so that artifact reconstruction is part of the portable Coworker contract.
12. As a User, I want opening a **Coworker Builder Conversation** to keep returning an existing valid conversation when possible, so that editor navigation remains stable.
13. As a User, I want **Coworker Builder Conversations** to keep auto-approval disabled, so that Builder edits are not accidentally auto-approved.
14. As a developer, I want **Coworker Builder Conversation** creation behind one module interface, so that the ownership, workspace, type, and auto-approval invariants are explicit.
15. As a User, I want **Coworker Forwarding Alias** creation, rotation, and disablement to keep current behavior, so that forwarded email routing remains predictable.
16. As a developer, I want **Coworker Forwarding Alias** lifecycle behavior next to inbound forwarded email routing, so that all forwarded email routing rules have locality.
17. As an operator, I want missing receiving-domain configuration to keep surfacing the same failures, so that operational behavior does not change during the refactor.
18. As a developer, I want Coworker run detail and run list views behind one read-model module, so that run event mapping, debug info fallback, and cursor behavior are not mixed with unrelated router code.
19. As a support engineer, I want Coworker run detail to keep including ordered events and linked conversation identifiers, so that debugging remains possible.
20. As a workspace admin, I want admin Coworker run views to keep working, so that workspace-level support workflows are not disrupted.
21. As a developer, I want Coworker catalog reads behind one module interface, so that list and detail aggregation have locality.
22. As a User, I want Coworker list and detail responses to keep their current fields, including recent runs, documents, tags, **Toolbox**, schedule, and **Start Message** settings, so that UI behavior does not change.
23. As a developer, I want Coworker profile writes behind one module interface, so that create, update, and delete workflows are testable without the full router fixture.
24. As a User, I want Coworker create, update, and delete behavior to keep scheduler synchronization semantics, so that scheduled Coworkers remain correct.
25. As a User, I want model policy checks to keep rejecting admin-only models for non-admin users, so that access control behavior is unchanged.
26. As a User, I want **Start Message** validation to remain enforced, so that Coworkers requiring a **Start Message** always have a **User Input Prompt**.
27. As a developer, I want Coworker triggering behind one module interface, so that runtime-originated **Bap MCP Server** behavior and Spawn Depth rules stay local and testable.
28. As an MCP client, I want runtime-originated Coworker triggers to keep enforcing Spawn Depth, so that ADR-0013 behavior remains intact.
29. As an admin user, I want remote integration trigger metadata to keep working, so that admin-triggered runs preserve actor context.
30. As a non-admin user, I want remote integration trigger inputs to remain forbidden, so that admin-only behavior is not widened.
31. As a developer, I want Toolbox resolution in one shared module, so that **Workspace MCP Server Allowlist** behavior is consistent across create, update, list, get, sharing, export, and import.
32. As a developer, I want **Platform MCP Server** behavior to remain separate from **Workspace MCP Server Allowlist** behavior, so that ADR-0013 and the MCP runtime ADR remain respected.
33. As a developer, I want Builder metadata backfill behind one small module, so that catalog and definition exports can share the same invariant.
34. As a User, I want missing Coworker display metadata to keep being filled after a **Coworker Builder Conversation** receives instructions, so that existing Builder behavior remains intact.
35. As an app admin, I want impersonation target lookups to keep using app-admin authority, so that app-admin workflows remain distinct from workspace-admin views.
36. As a workspace admin, I want workspace Coworker admin views to keep using workspace-admin authority, so that authority models do not get mixed.
37. As a developer, I want **Coworker Document** router procedures to stay thin and delegate to the existing document module, so that no shallow duplicate document module is introduced.
38. As a developer, I want remote integration target/search procedures in a small transport adapter, so that shallow admin glue does not remain in the main router.
39. As a developer, I want no database schema changes for this refactor, so that the work stays behavior-preserving.
40. As a developer, I want no public oRPC contract changes for this refactor, so that web, CLI, and MCP callers remain compatible.
41. As a maintainer, I want the refactor to preserve existing ADR decisions, so that the module split does not reopen product decisions about **Pending Starts**, **Bap MCP Server**, or MCP runtime access.

## Implementation Decisions

- This is a Big Bang refactor. The final shape matters more than incremental compatibility wrappers, and the existing router should not remain as a second implementation path.
- The main Coworker router should become procedure composition and transport wiring. It should not own product read-model normalization, storage reconstruction, scheduler side effects, alias lifecycle, or event payload interpretation.
- **Coworker History** becomes a deep module with one primary interface that accepts database, user id, workspace id, optional date range, optional cursor, and limit, then returns history entries and an optional next cursor.
- **Coworker History** owns cursor decoding/encoding, run querying, stale-run reconciliation, event grouping, write-action detection, target extraction, preview construction, status derivation, and sorting.
- **Coworker History** keeps the existing status values: success, denied, error, and pending.
- **Coworker Definition** becomes a deep module for export, JSON import, and shared Coworker import.
- **Coworker Definition** owns definition schema versions, document embedding, document copy, generated artifact embedding, generated artifact restore, imported Builder artifact conversation creation, model policy checks, username normalization, auth source normalization, **Start Message** validation, and the rule that imported Coworkers start off.
- **Coworker Builder Conversation** becomes a focused module for finding or creating the conversation attached to a Coworker for iterative editing.
- **Coworker Builder Conversation** owns the invariant that Builder conversations are Coworker conversations owned by the same **User** in the same workspace and have auto-approval disabled.
- **Coworker Forwarding Alias** lifecycle moves into the existing forwarded email service module, next to inbound forwarded email routing.
- **Coworker Forwarding Alias** owns receiving-domain lookup, email-forwarded trigger checks, active alias lookup, unique local-part retry, disablement, rotation, and replacement linkage.
- The forwarded email module owns receiving-domain configuration lookup so callers do not need to know the environment variable rule.
- Coworker run views become a web read-model module covering user run detail, user run list, workspace run list, and admin run detail.
- Coworker run views own run cursoring, stale-run reconciliation where required, event mapping, linked conversation id fallback, and debug info fallback from **Generation**.
- Coworker catalog becomes a web read-model module covering Coworker list and Coworker detail.
- Coworker catalog owns recent run summaries, tag aggregation, document summaries, policy projection, pinned sorting, and Builder metadata backfill calls.
- Coworker profile becomes a write workflow module covering create, update, and delete.
- Coworker profile owns input normalization, model policy, auth source normalization, username resolution, trigger-type restrictions, **Start Message** validation, Builder metadata generation on first prompt fill, selected **Workspace MCP Server Allowlist** resolution, scheduler sync, and scheduler cleanup.
- Coworker trigger becomes its own workflow module rather than living in profile or run view code.
- Coworker trigger owns remote integration admin checks, runtime-originated Spawn Depth evaluation, trusted user input, file attachments, debug deadline bounds, remote actor metadata, and delegation to the existing Coworker run trigger module.
- Toolbox behavior becomes a small shared module for selected **Workspace MCP Server Allowlist** resolution and normalized **Toolbox** projection.
- Builder metadata backfill becomes a small shared module for read-time metadata updates after a **Coworker Builder Conversation** receives instructions.
- Workspace-admin Coworker read views and app-admin impersonation target lookup remain separate modules because they use different authority models.
- **Coworker Document** procedures move to a thin router split that delegates to the existing document module. No new deep document module is needed.
- Remote integration target/search procedures move to a thin router split. They remain adapter glue over existing remote integration functions.
- No ADR is required. The decision is reversible module organization and does not introduce a hard-to-reverse product decision. The glossary updates record the domain language needed for the refactor.
- Existing ADRs remain authoritative: **Pending Starts** stay separate from model input; the **Bap MCP Server** remains a hard-wired **Platform MCP Server** with Spawn Depth behavior; **Workspace MCP Server Allowlist** behavior remains distinct from **Platform MCP Server** behavior.

## Testing Decisions

- Tests should verify external behavior at each module interface. They should not assert private helper calls, internal grouping maps, or implementation-only function boundaries.
- The main router test should shrink to transport-level behavior: schema acceptance where meaningful, authorization delegation, error pass-through, and procedure-to-module wiring.
- **Coworker History** module tests should cover successful writes, rejected approvals as denied entries, pending writes, edited approval payload precedence, failed writes as errors, multiple write actions in one run, read-only tool exclusion, cursor generation, invalid cursor behavior, and stale-run reconciliation ordering.
- **Coworker Definition** module tests should cover export with embedded **Coworker Documents**, export with generated artifacts, v1 import, v2 import with artifact restore, shared Coworker import, imported off-state behavior, model policy rejection, username normalization, and **Start Message** validation.
- **Coworker Builder Conversation** module tests should cover creating a new Builder conversation, returning an existing valid Builder conversation, disabling auto-approval on an existing Builder conversation, and replacing an invalid stale Builder conversation reference.
- **Coworker Forwarding Alias** module tests should cover missing receiving-domain behavior, non-email-forwarded trigger rejection, active alias reuse, unique alias creation retry, disablement with and without an active alias, rotation with replacement linkage, and retry exhaustion.
- Coworker run view tests should cover user run detail, missing run, inaccessible Coworker, ordered events, conversation id fallback from **Generation**, debug info fallback, user run list, workspace run pagination, status filters, Coworker filters, and admin run detail.
- Coworker catalog tests should cover list summaries, recent run classification, tag aggregation, pinned sorting, detail documents, detail runs, missing Coworker, and Builder metadata backfill.
- Coworker profile tests should cover create happy path, disabled trigger rejection, admin-only model rejection, metadata normalization, selected **Workspace MCP Server Allowlist** resolution, scheduler sync failure, update happy path, schedule-only sync behavior, non-schedule update behavior, first prompt metadata fill, delete scheduler cleanup, and delete not found.
- Coworker trigger tests should cover ordinary manual trigger, default empty payload, file attachments, trusted user input, remote integration admin metadata, non-admin remote integration rejection, managed MCP Spawn Depth allow, and managed MCP Spawn Depth rejection.
- Toolbox tests should cover selected mode resolving enabled **Workspace MCP Servers**, explicit selected server ids taking precedence, non-selected modes returning explicit ids only, empty integrations, deterministic ordering, and skill slug normalization.
- Builder metadata tests should cover no-op without Builder conversation, no-op without prompt, no-op when metadata is complete, update when metadata is missing, and owner/workspace-constrained update fallback.
- Admin view and impersonation target tests should cover their different authority models without mixing workspace-admin and app-admin access assumptions.
- Existing router tests provide prior art for many behavior cases, but detailed cases should move to the new module tests instead of remaining in the router fixture.
- After implementation, run focused tests for the moved modules and the Coworker router, then run the repository check command. If the change touches enough shared behavior, run the broader test suite as well.

## Out of Scope

- No database schema changes.
- No lint rule or lint configuration changes.
- No public oRPC contract changes.
- No product behavior changes to Coworker create, update, delete, trigger, history, run views, import/export, sharing, **Coworker Documents**, **Coworker Builder Conversation**, or **Coworker Forwarding Alias** workflows.
- No changes to **Pending Start** semantics, **Start Message** semantics, or **User Input Prompt** semantics.
- No changes to **Bap MCP Server** hard-wiring, Spawn Depth limits, or managed token behavior.
- No changes to **Workspace MCP Server Allowlist** semantics beyond moving existing behavior behind a shared module.
- No new ADR unless implementation uncovers a hard-to-reverse trade-off that is surprising without context.
- No attempt to redesign the Coworker UI, run history UI, or import/export file format beyond preserving the existing versioned contract.

## Further Notes

- The target line-count outcome is that the main Coworker router and its router test file each fall below 1000 lines.
- The refactor should prefer deep modules over pass-through services. A module earns its place only if deleting it would force its complexity to reappear in multiple callers or tests.
- The glossary now includes **Coworker History**, **Coworker Definition**, **Coworker Builder Conversation**, and **Coworker Forwarding Alias** to support precise naming during the refactor.
- The implementation should stay scoped to Coworker router decomposition and should avoid unrelated cleanup, formatting churn, or opportunistic feature changes.
