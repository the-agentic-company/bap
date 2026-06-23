# Centralize Authored Prompt Assets in @bap/prompts

Bap will make `@bap/prompts` the canonical home for production **Authored Prompt Assets**: OpenCode Agent Definitions, reusable runtime instruction sections, model helper prompts, product prompt templates, and other Bap-authored instruction or task frames sent to a model or runtime agent. Core, web, sandbox, and MCP packages will own orchestration, I/O, provider calls, and runtime decisions, while `@bap/prompts` owns prompt text, stable prompt IDs, filesystem path helpers, and pure string renderers.

**Consequences**

Prompt prose is centralized for review without moving **Prompt Composition** orchestration out of core. `@bap/prompts` must stay low in the dependency graph: it accepts plain structural inputs and does not import Bap database, web, core, sandbox, model-provider, or runtime packages.

OpenCode Agent Definitions remain real Markdown files because OpenCode consumes files with frontmatter. Other prompt assets use plain Markdown plus TypeScript renderers. Long prompt prose should not live in giant multiline TypeScript literals after this refactor.

Sandbox image builders must copy prompt assets directly from `@bap/prompts` into runtime locations such as OpenCode's agent directory. Bap will not rely on symlinks or duplicate staged copies under the sandbox package, because provider archive behavior can preserve symlinks instead of dereferencing them and because duplicate physical homes make prompt drift likely.

E2B and Docker are not the active validation focus for this refactor, but their build references must not silently point at deleted legacy prompt paths. If their build context must widen to reach `@bap/prompts`, that is an intentional consequence of centralizing physical prompt assets rather than staging duplicates.
