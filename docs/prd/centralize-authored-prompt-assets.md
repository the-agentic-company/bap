# PRD: Centralize Authored Prompt Assets

## Problem Statement

Bap has production prompt prose spread across sandbox assets, runtime TypeScript, web prompt templates, and model helper functions. This makes it hard to review the complete set of **Authored Prompt Assets**, easy for package-local copies to drift, and risky to move OpenCode Agent Definitions because sandbox image builders can accidentally keep pointing at deleted or duplicated locations.

Prompt-related language is also overloaded. Bap already has user-facing concepts such as **Parameter Prompt** and **Agentic-App Prompt**, while the refactor concerns Bap-authored source material and **Prompt Composition**. Without a clear owner and vocabulary, future changes will keep mixing model-facing instruction text, runtime assembly logic, UI placeholders, tests, and skill content.

## Solution

Create a dedicated private workspace package, `@bap/prompts`, as the canonical home for production **Authored Prompt Assets** and pure prompt rendering utilities. The package will store long prompt prose in Markdown, expose stable IDs and path helpers, and provide dependency-light TypeScript render functions that accept plain structural inputs and return strings.

Runtime and product packages will consume `@bap/prompts` while keeping their current responsibilities: core owns **Prompt Composition** orchestration and runtime inclusion decisions, web owns request handling and UI flows, sandbox owns provider image construction, and service packages own model calls and database access. The refactor is behavior-preserving first: prompt wording, OpenCode agent IDs, section keys, and observable composed prompt behavior should remain unchanged except for unavoidable whitespace normalization.

## User Stories

1. As a Bap engineer, I want one package that contains production **Authored Prompt Assets**, so that I can review model-facing instruction text without hunting through unrelated modules.
2. As a Bap engineer, I want OpenCode Agent Definitions to live in the prompt package, so that runtime personas have a single physical source of truth.
3. As a Bap engineer, I want reusable runtime instruction sections to live in the prompt package, so that long prose no longer sits inside giant TypeScript string literals.
4. As a Bap engineer, I want product prompt templates to live in the prompt package, so that web flows and runtime flows use the same prompt asset conventions.
5. As a Bap engineer, I want production model helper prompts to live in the prompt package, so that metadata, title, and language prompts are visible with the rest of the prompt surface.
6. As a Bap engineer, I want integration CLI instruction frames to live in the prompt package, so that the instructions given to runtime agents are reviewed as prompt assets.
7. As a Bap engineer, I want coworker-related runtime frames to live in the prompt package, so that **Coworker Run** model input is assembled from named prompt renderers.
8. As a Bap engineer, I want Slack bridge context text to live in the prompt package, so that Bap-authored task context sent into a **Generation** is not hidden in service code.
9. As a Bap engineer, I want custom and community skill instruction frames to live in the prompt package, so that skill discovery instructions follow the same pattern as other runtime instructions.
10. As a Bap engineer, I want prompt renderers to accept plain data shapes, so that `@bap/prompts` does not depend on database, web, core, sandbox, model-provider, or runtime packages.
11. As a Bap engineer, I want prompt renderers to be pure string functions, so that they can be tested without model clients, database state, or sandbox providers.
12. As a Bap engineer, I want Authored Prompt Asset paths exported through stable helpers, so that sandbox builders can copy real files without knowing internal package layout.
13. As a Bap engineer, I want OpenCode agent IDs exported from `@bap/prompts`, so that the package that owns OpenCode Agent Definitions also owns their stable identifiers.
14. As a Bap engineer, I want the old core agent ID import path to re-export temporarily, so that the refactor does not require every caller to change in one risky pass.
15. As a Bap engineer, I want long prompt prose stored in Markdown, so that prompt reviews look like content reviews rather than code reviews.
16. As a Bap engineer, I want TypeScript used for renderers and constants only, so that dynamic data shaping remains explicit without burying authored prose.
17. As a Bap engineer, I want all prompt templates to use Markdown rather than text files, so that prompt assets have one main prose format.
18. As a Bap engineer, I want frontmatter only where a runtime consumes it, so that non-OpenCode prompt assets do not carry unused metadata.
19. As a Bap engineer, I want sandbox image builders to copy prompt assets directly from the prompt package, so that deleted legacy paths cannot silently survive.
20. As a Bap engineer, I want no symlink dependency in sandbox builds, so that provider archive behavior cannot produce dangling or preserved symlinks instead of real prompt files.
21. As a Bap engineer, I want E2B and Docker references updated even if Daytona is the active provider, so that unused providers do not rot silently.
22. As a Bap engineer, I want live validation to focus on Daytona first, so that verification effort matches the provider currently in use.
23. As a Bap engineer, I want E2B and Docker validation to remain unit/typecheck-level in this pass, so that the refactor does not balloon into provider certification work.
24. As a future maintainer, I want **Prompt Composition** orchestration to stay in core, so that the prompt package does not become a runtime execution package.
25. As a future maintainer, I want Bap-authored prompt text separated from runtime inclusion rules, so that copy changes and composition changes can be reviewed independently.
26. As a future maintainer, I want production prompt assets tested directly in their owning package, so that regressions do not rely only on indirect core or web tests.
27. As a future maintainer, I want behavior-preserving tests around composed prompts, so that moving assets does not accidentally change section order or content.
28. As a future maintainer, I want the glossary to distinguish **Authored Prompt Asset**, **Prompt Composition**, and **OpenCode Agent Definition**, so that prompt does not become an overloaded catch-all.
29. As a future maintainer, I want generated skill templates to stay out of this refactor, so that skill authoring assets do not blur into runtime prompt assets.
30. As a future maintainer, I want UI placeholders, examples, tests, and fixtures excluded, so that the prompt package stays focused on production model-facing instruction and task frames.
31. As a future maintainer, I want MCP tool descriptions excluded, so that schema/tool metadata remains owned by the server packages that expose those tools.
32. As a future maintainer, I want transcript and export formatting excluded, so that general display formatting does not become prompt package surface area.
33. As a release engineer, I want prompt assets to participate in workspace check and test tasks, so that prompt package changes are validated like other production code.
34. As a release engineer, I want prompt package dependency direction to be simple, so that adding it to core, web, and sandbox does not introduce cycles.
35. As a reviewer, I want the migration to avoid prompt wording edits, so that behavioral regressions can be attributed to the refactor rather than content changes.

## Implementation Decisions

- Create a private workspace package named `@bap/prompts`.
- `@bap/prompts` owns production **Authored Prompt Assets**, stable prompt identifiers, asset path helpers, and pure render/build functions.
- `@bap/prompts` has no Bap package dependencies. It can use Node/Bun standard filesystem APIs and accepts plain structural inputs.
- Core continues to own **Prompt Composition** orchestration: which sections are included for chat, **Builder Chat**, and **Coworker Run** generations, in what order, and with which run-specific context.
- Web continues to own HTTP route behavior, UI flows, and model/service calls that happen in web-owned code.
- Sandbox continues to own provider image construction, but it must copy prompt assets from `@bap/prompts` rather than legacy sandbox-local agent directories.
- Move OpenCode Agent Definitions into `@bap/prompts` as Markdown files with their existing OpenCode frontmatter.
- Move product prompt templates into `@bap/prompts` as Markdown files.
- Move reusable runtime prompt sections into `@bap/prompts` as Markdown assets or pure renderers, depending on whether the text is static or parameterized.
- Move production model helper prompts into `@bap/prompts` as pure renderers.
- Move production model-facing instruction/task frames into `@bap/prompts` when they can be rendered from plain inputs.
- Use Markdown and TypeScript as the primary prompt package formats. Do not keep plain text prompt assets in the first-pass target shape.
- Use frontmatter only for OpenCode Agent Definitions because OpenCode consumes that metadata.
- Keep behavior stable: no intentional prompt wording changes, no agent ID changes, no runtime section key changes, and no composition order changes.
- Keep the old core agent ID import path as a temporary re-export while establishing `@bap/prompts` as the canonical owner.
- Update E2B, Docker, Daytona, tests, and docs so no code silently references deleted legacy prompt paths.
- Prefer widening sandbox build contexts or direct package asset copies over generated duplicate prompt copies.
- Do not rely on symlinks for prompt assets in provider build contexts.
- Do not move generated skill templates in this refactor.
- Do not move test prompts, fixtures, UI placeholders, marketing examples, transcript formatting, or MCP tool descriptions in this refactor.

## Testing Decisions

A good test validates external behavior and stable rendered output, not implementation details such as internal file names or helper call sequences. Prompt tests should assert meaningful output, section keys, IDs, and path existence rather than duplicating entire Authored Prompt Assets.

- Add unit tests in `@bap/prompts` for pure renderers.
- Test that exported OpenCode agent IDs match the expected runtime names.
- Test that exported asset path helpers point to existing files or directories.
- Test that the template deploy renderer preserves existing placeholder substitution behavior.
- Test model helper prompt renderers with representative inputs and assert important instructions and dynamic fields appear.
- Test runtime section renderers for key headings and dynamic interpolation.
- Preserve existing core prompt composition tests for section order, section keys, selected skill behavior, optional section omission, and key phrase presence.
- Update sandbox OpenCode agent tests to read the new canonical asset directory.
- Update web template deploy tests to load the Markdown template from `@bap/prompts` instead of a web-local text file.
- Run package-level checks for `@bap/prompts`.
- Run affected core, web, and sandbox tests where practical.
- Daytona is the live validation priority for this refactor. E2B and Docker should be kept typecheck/unit-test clean, but live provider rebuild validation is out of scope unless explicitly requested.

## Out of Scope

- Improving prompt wording or changing agent behavior intentionally.
- Moving **Prompt Composition** orchestration out of core.
- Moving generated skill templates or broader skill authoring assets into `@bap/prompts`.
- Moving test fixtures, live test prompts, UI examples, placeholder copy, marketing copy, or docs copy into `@bap/prompts`.
- Moving MCP tool descriptions or input schema descriptions into `@bap/prompts`.
- Certifying live E2B or Docker builds.
- Reworking provider startup, OpenCode configuration semantics, model selection, or runtime MCP behavior.
- Replacing existing model providers or changing model call sites beyond using prompt renderers.

## Further Notes

This PRD follows ADR 0016, **Centralize Authored Prompt Assets in `@bap/prompts`**. The glossary now distinguishes **Authored Prompt Asset**, **Prompt Composition**, and **OpenCode Agent Definition** so future work can avoid overloading prompt across user-facing messages, runtime instructions, and source assets.

The first pass should be treated as a source-of-truth refactor. Prompt quality improvements, copy edits, and behavior changes should happen in later work after the physical ownership change is stable.
