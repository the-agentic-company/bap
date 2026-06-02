# PRD: output.html Generation Output Preview

## Problem Statement

Users can ask a **Generation** to create an HTML page, but CmdClaw currently treats generated sandbox files as downloadable attachments only. If the agent creates `output.html`, the User has to notice the file chip, download it, and open it outside the chat surface to inspect the result. That breaks the chat workflow for UI prototypes, reports, dashboards, and other HTML outputs that are meant to be viewed immediately.

The user wants normal chat to support an opt-in right-side preview pane that displays the newest generated `output.html` inside the chat page. The preview should feel like the collapsible right panel used in the coworker editor, while preserving the existing transcript and download behavior.

## Solution

CmdClaw will add an opt-in **Generation Output Preview** capability to `ChatArea`. When enabled by the normal chat routes, the chat page will render a collapsible right-side panel using the existing dual-panel workspace pattern. The left panel remains the conversation; the right panel displays the latest generated `output.html` in a sandboxed iframe.

The runtime file collection path will treat a sandbox file named exactly `output.html` as a special presence-based output. It will auto-collect that file after a completed **Generation** even when the assistant does not mention it in the final answer, and it will use the existing sandbox file storage model. The preview will fetch authenticated HTML text from the web app and render it with iframe `srcDoc`; the existing sandbox file download flow remains available for downloading the raw file.

The first rollout enables this only on normal chat pages. Other chat surfaces can opt in later through the same reusable `ChatArea` prop.

## User Stories

1. As a User, I want `output.html` to appear in chat when a Generation creates it, so that I can inspect the result without leaving CmdClaw.
2. As a User, I want the preview to appear in a right-side panel, so that I can see the conversation and the generated page together.
3. As a User, I want the preview panel to be collapsible, so that I can recover the full chat width when I do not need the output.
4. As a User, I want the preview panel to behave like the coworker editor panel, so that the layout feels familiar.
5. As a User, I want the latest `output.html` to open automatically after completion, so that generated UI appears without extra clicks.
6. As a User, I want closing the preview in one conversation not to affect other conversations, so that each chat keeps its own workspace state.
7. As a User, I want the newest `output.html` to be shown by default, so that the preview reflects the latest result.
8. As a User, I want older generated file chips to remain downloadable, so that I can still retrieve prior outputs.
9. As a User, I want clicking file chips to keep downloading files, so that existing attachment behavior stays predictable.
10. As a User, I want a toolbar in the preview panel, so that I can identify, refresh, download, or close the preview.
11. As a User, I want a refresh control, so that I can retry loading the current preview if the frame or network request fails.
12. As a User, I want a download control in the preview, so that I can save the rendered `output.html` file.
13. As a User, I want a compact failure state when preview loading fails, so that I understand the preview cannot be displayed.
14. As a User, I want files too large to preview to remain downloadable, so that large outputs are not lost.
15. As a User, I want the preview to render scripts when the generated HTML needs interactivity, so that prototypes and dashboards work.
16. As a User, I want the generated page isolated from CmdClaw, so that untrusted HTML cannot access app data.
17. As a User, I want `output.html` to be self-contained, so that the preview does not depend on missing relative files.
18. As a User, I want normal chat to opt in first, so that other chat surfaces do not change unexpectedly.
19. As a developer, I want `output.html` collection to use the existing sandbox file storage model, so that the feature does not introduce a second artifact system.
20. As a developer, I want `output.html` auto-collection to bypass the final-answer mention heuristic, so that the product rule is based on file presence.
21. As a developer, I want the auto-collection exception to match the exact basename `output.html`, so that unrelated HTML files are not promoted accidentally.
22. As a developer, I want `/app/output.html` and deeper paths such as `/app/dist/output.html` to count, so that common build outputs work.
23. As a developer, I want `my-output.html`, `output.htm`, and case variants such as `output.HTML` not to count, so that the contract stays precise.
24. As a developer, I want the finalizer to check for `output.html` even when a Generation had no tool calls, so that presence-based output still works.
25. As a developer, I want the `output.html` check to be narrow and bounded, so that text-only turns do not perform broad file artifact work.
26. As a developer, I want preview content served by an authenticated app route, so that ownership and workspace access are enforced before rendering.
27. As a developer, I want the iframe to use `srcDoc` rather than a presigned S3 URL, so that the preview stays isolated from app origin and storage URLs.
28. As a developer, I want a tight iframe sandbox policy, so that generated scripts can run without same-origin access to CmdClaw.
29. As a developer, I want preview HTML capped below the general sandbox file limit, so that large generated pages do not freeze the browser.
30. As a developer, I want the general sandbox file limit to remain unchanged, so that download behavior is not narrowed by preview constraints.
31. As a developer, I want preview support controlled by a `ChatArea` opt-in, so that each chat caller can decide when to expose the right panel.
32. As a developer, I want normal chat routes to pass the opt-in, so that v1 affects only the requested chat surface.
33. As a developer, I want coworker run chat and coworker builder chat to remain unchanged in v1, so that rollout is scoped.
34. As a developer, I want the preview selector logic extracted into a small testable module, so that “latest output” behavior can be verified without rendering the full chat.
35. As a developer, I want preview route validation extracted into a small service, so that ownership, filename, MIME, and size rules are testable.
36. As a developer, I want streaming behavior unchanged, so that preview appears only after completed file collection.
37. As a developer, I want the preview panel to use existing authenticated download behavior for the toolbar download action, so that duplicate download APIs are avoided.
38. As a developer, I want persisted conversations to discover the latest `output.html` from stored sandbox files, so that refresh/history views show the preview.
39. As a developer, I want newly completed Generations to update the preview from done artifacts, so that live chat shows the output without requiring a full page refresh.
40. As a support engineer, I want preview failures to be visible in the UI, so that a broken or oversized generated page is distinguishable from no output.
41. As a future developer, I want the decision recorded in an ADR, so that the sandboxed `srcDoc` route is understood as deliberate.
42. As a future developer, I want the glossary term **Generation Output Preview**, so that product and code discussions avoid ambiguous terms like “canvas.”

## Implementation Decisions

- Add **Generation Output Preview** as the canonical product term for a user-facing preview of a file produced by a **Generation**.
- Record the architecture decision in ADR 0010: `output.html` is self-contained, auto-collected by exact filename, rendered through authenticated app preview content, and displayed in a sandboxed iframe.
- Add a reusable `ChatArea` opt-in for output previews. The default is disabled.
- Enable the opt-in only in normal chat routes for v1.
- Do not enable the preview in coworker run chat, coworker builder chat, shared conversations, or other embedded chat surfaces in v1.
- Use the existing dual-panel workspace component for the chat layout when output preview is enabled and a previewable file exists.
- The left panel is the existing chat transcript and input.
- The right panel is a collapsible **Generation Output Preview** pane.
- Desktop layout shows chat and preview side by side.
- Mobile behavior should avoid crushing the transcript. The existing dual-panel mobile switcher pattern can be used if it fits the normal chat page, or the implementation can keep the preview hidden/collapsible on mobile for v1 as long as normal chat remains usable.
- The preview panel opens automatically when a new latest `output.html` appears, unless the User manually collapsed the panel for that conversation.
- The manual collapsed state is remembered per conversation.
- A new conversation can use temporary local state before it receives a durable conversation id; once the conversation id exists, the durable per-conversation key is used.
- The preview always selects the newest `output.html` in the conversation.
- Do not build an output history picker for v1.
- Clicking older sandbox file chips keeps the existing download behavior and does not select an older preview.
- The preview toolbar includes the title `output.html`, refresh, download, and close/collapse controls.
- Refresh re-fetches the latest preview content.
- Download uses the existing sandbox file download flow.
- Close collapses the right panel and records the per-conversation manual collapse state.
- Runtime file collection should continue to collect final-answer-mentioned files as it does today.
- Add a narrow collection exception for sandbox files whose basename is exactly `output.html`.
- Exact basename matching is case-sensitive.
- `output.html` can be located anywhere inside the existing collected scan roots.
- If multiple exact `output.html` files are present in one Generation, prefer `/app/output.html`; otherwise prefer the newest modified candidate if reliable metadata is available. If reliable modified-time ordering is not available, use deterministic path ordering and document that tie-breaker in tests.
- `output.html` should be checked after **Generation** completion, not while the Generation is running.
- The finalizer should run the narrow `output.html` check even when the broad mentioned-file auto-collection path would normally be skipped because there were no tool calls or staged uploads.
- The `output.html` check must remain bounded and should not expand into a broad scan of every generated file on text-only turns.
- Store auto-collected `output.html` through the existing sandbox file table and object storage path.
- The sandbox file record is sufficient for v1; no new database table is required.
- No schema change is required unless implementation discovers that existing sandbox file metadata cannot identify or order latest `output.html` records.
- Add an authenticated preview API contract that accepts a sandbox file identifier and returns HTML text for preview.
- The preview API verifies that the sandbox file belongs to the authenticated User and active workspace.
- The preview API rejects files whose basename is not exactly `output.html`.
- The preview API rejects missing storage keys and unavailable files.
- The preview API caps returned HTML around 2 MB.
- Files above the preview cap remain downloadable through the existing download flow.
- The preview API should return enough structured error information for the UI to distinguish too-large, not-found, and generic load failures.
- Render preview content with iframe `srcDoc`.
- The iframe sandbox should allow scripts and forms, but must not allow same-origin access to CmdClaw.
- Do not sanitize or rewrite generated HTML for v1; iframe isolation is the safety boundary.
- Do not support relative assets in v1. `output.html` must be self-contained, with CSS, JavaScript, and small images inlined when needed.
- Keep the existing presigned download URL path for downloading raw sandbox files.
- Do not use presigned S3 URLs as iframe `src`.
- Extract output selection into a small module that can identify the latest `output.html` from conversation messages, persisted sandbox files, and done artifacts.
- Extract preview route validation and loading into a small server module where practical, so API tests can exercise the security and size rules without rendering React.
- Existing chat streaming, approvals, auth waits, and message persistence should remain unchanged.
- The preview appears only after completion because sandbox files are collected during finalization.
- The UI should show no preview panel at all when the opt-in is disabled or the conversation has no `output.html`.
- The UI should show a compact empty/loading/error state inside the panel when an expected preview is being fetched or cannot render.
- No lint rules or lint configuration should be changed.

## Testing Decisions

- Tests should verify external behavior and durable contracts, not duplicate implementation branching.
- Good tests assert file collection outcomes, API authorization, preview selection, panel visibility, iframe sandbox attributes, and user-visible states.
- Add unit tests for the output selection module:
  - returns no preview when no sandbox file is named exactly `output.html`.
  - selects the newest `output.html` across messages.
  - ignores `my-output.html`, `output.htm`, and case variants.
  - updates selection when done artifacts include a newer `output.html`.
- Add runtime file collection tests:
  - auto-collects `output.html` even when the assistant did not mention it.
  - preserves current mentioned-file auto-collection behavior for non-`output.html` files.
  - checks `output.html` when the normal broad collection gate would be skipped.
  - applies the multiple-candidate tie-breaker.
  - excludes staged user uploads and previously sent files as appropriate.
- Add server preview API tests:
  - returns HTML for an owned active-workspace `output.html`.
  - rejects files outside the active workspace.
  - rejects files owned by another User.
  - rejects non-`output.html` files.
  - rejects missing storage keys.
  - rejects or reports files above the preview cap.
  - does not return presigned S3 URLs for preview content.
- Add ChatArea UI tests:
  - normal chat routes pass the output preview opt-in.
  - `ChatArea` does not show a preview when the prop is absent.
  - when enabled and latest `output.html` exists, the right panel appears.
  - manual collapse is remembered per conversation.
  - a newer `output.html` opens automatically unless the conversation was manually collapsed.
  - the toolbar refresh re-fetches preview content.
  - the toolbar download invokes the existing sandbox file download flow.
  - the iframe uses `srcDoc` and the intended sandbox policy.
  - the panel shows a too-large or load-failure state without breaking the chat transcript.
- Add regression tests for existing sandbox file chips so click behavior remains download-first.
- Prior art exists in sandbox file live and CLI tests, generation manager sandbox file tests, conversation router sandbox file download tests, chat area tests, message item tests, and dual-panel workspace tests.
- After implementation, run targeted tests for changed runtime collection, preview API, selection module, and ChatArea behavior.
- Run `bun run check` before completion.
- If the implementation touches database schema unexpectedly, use `bun run db:push` for local schema update per app instructions.

## Out of Scope

- Enabling the preview in coworker run chat, coworker builder chat, shared conversation pages, inbox embeds, or other non-normal chat surfaces.
- Rendering older `output.html` files from a history picker.
- Changing sandbox file chip clicks to select previews.
- Live preview updates while a Generation is still running.
- Polling the sandbox filesystem for preview changes.
- Supporting relative asset bundles next to `output.html`.
- Serving arbitrary generated HTML files by name.
- Case-insensitive `output.html` matching.
- Sanitizing, rewriting, or bundling generated HTML.
- Adding a new artifact table or broad artifact management system.
- Changing the general 50 MB sandbox file upload limit.
- Changing lint rules or lint configuration.
- Creating or updating Linear issues directly.

## Further Notes

- Domain term added: **Generation Output Preview**.
- ADR 0010 records the security-sensitive rendering decision.
- The feature is intentionally opt-in at the chat caller boundary: reusable capability now, narrow rollout first.
- The coworker can be instructed later to write self-contained HTML to `output.html` when the desired result is a visual preview.
- Suggested Linear title: `Chat: preview latest generated output.html`.
- Suggested Linear team: `cmdlaw`.
- Suggested Linear label/status: use the ready-for-agent equivalent in Linear because the behavior and implementation decisions are specified.
