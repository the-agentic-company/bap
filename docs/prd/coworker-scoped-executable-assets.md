# PRD: Coworker-scoped executable assets

> Status: **proposal / problem framing**. This PRD describes a problem and a few
> possible directions. No approach is committed yet — it exists to gather a
> decision before any implementation.

## Problem Statement

Many coworkers whose job is to produce a rich artefact (an HTML panel, a PDF,
a large JSON) cannot reliably have the model emit that artefact inline. The
generation runtime aborts a run when no progress event arrives for 90s
(`runtimeProgressStallMs` in
`packages/core/src/server/services/lifecycle-policy.ts`), and a single long
tool call — e.g. a `Write` emitting a multi-KB HTML body — produces no
intermediate progress events while it runs, so the watchdog fires
(`runtime_no_progress_after_prompt`). The robust, field-tested pattern is to
bundle a deterministic render script (`render.py`) that the agent calls with a
small `data.json`; the script returns in seconds and never trips the watchdog.

Today the **only** primitive that can deliver executable code into the run
sandbox is a **skill**. Coworker documents
(`packages/core/src/server/sandbox/prep/coworker-documents-prep.ts`) are mounted
read-only under `/home/user/coworker-documents/<id>/` and the prompt only tells
the agent to *read* them — they are never executed. Skill files, by contrast,
are staged into `/app/.opencode/skills/<slug>/`
(`packages/core/src/server/sandbox/prep/skills-prep.ts`) where the runtime
treats them as runnable skills.

The consequence at scale: every coworker that renders an artefact spawns a
one-off `*-render` skill in the **workspace-level** skill library
(`skill` table is workspace-scoped, gated by `skill.enabled` plus the
coworker's `allowedSkillSlugs`). A workspace with N HTML coworkers accumulates N
render skills that each belong to exactly one coworker. That is:

- **Noisy** — the shared skill list fills with single-use render scripts that
  are not meant to be discovered or reused.
- **Confusing ownership** — a "shared library" entry that is really private to
  one coworker.
- **Extra ceremony** — a render script that conceptually belongs to a
  coworker's setup has to be authored, imported as a skill, and then allow-listed
  on the coworker, instead of just travelling with the coworker.

We want a way to attach an **executable** asset (a render script + its template)
**directly to a single coworker**, so it travels with that coworker's setup and
does not pollute the shared skill library — while keeping the watchdog-safe
"agent emits a tiny `data.json`, script does the rendering" pattern.

## Possible Directions

These are sketches to choose between, not a committed design.

### Direction A — executable flag on coworker documents

Extend the existing `coworkerDocument` model with a notion of an executable
asset: a `path` (so it lands at a predictable place) and a flag that opts the
file into an execution-friendly staging directory (e.g.
`/home/user/coworker-scripts/<id>/`). The document prep step would stage these
alongside today's read-only documents, and the prompt attachment text would tell
the agent it may run them.

- **Pros:** reuses the document upload/storage path (S3, `coworker_uploadDocument`,
  the `files` array on `coworker.create`); smallest new surface; naturally
  per-coworker.
- **Cons:** overloads "document" (today a pure reference concept) with execution
  semantics; needs care that read-only docs stay non-executable.

### Direction B — a dedicated `coworkerAsset` model

Introduce a first-class per-coworker asset table separate from both documents
and skills, with its own sandbox staging path and its own MCP tools
(`coworker_uploadAsset`, …). Documents stay "read-only reference", skills stay
"shared reusable", assets are "private executable bundle for this coworker".

- **Pros:** clean separation of the three concepts; no overloading; room for
  asset-specific behaviour (entrypoint, run hints).
- **Cons:** most new surface (schema, migration, prep step, MCP tools, UI);
  another artefact system to maintain.

### Direction C — keep skills, but make a skill ownable by a coworker

Keep the skill machinery but allow a skill to be scoped/owned by a single
coworker so it is hidden from the shared workspace skill library and auto-enabled
on its owner. This removes the pollution and the allow-list step without
inventing a new delivery path.

- **Pros:** reuses the proven skill staging + execution path; minimal runtime
  change; the render-script pattern is unchanged.
- **Cons:** complicates the skill ownership/visibility model; "a skill that is
  not in the skill library" may be a confusing concept.

### Direction D (orthogonal) — soften the watchdog so inline emission is viable

Make the 90s no-progress watchdog account for an in-flight tool call (a `Write`
or `bash` that is running but not emitting progress events). If a long single
generation no longer aborts, many coworkers would not need a render script at
all, reducing the demand for any of A/B/C.

- **Pros:** removes the root-cause footgun for all builders, not just
  HTML/render cases.
- **Cons:** deepest and riskiest change (runtime semantics, risk of masking
  genuinely hung runs); even if fixed, a bundled script still wins on
  determinism and byte-exact output, so this complements rather than replaces
  A/B/C.

## Open Questions

1. Is the goal narrow (stop polluting the skill library with per-coworker render
   scripts) or broad (a general per-coworker executable-asset capability)? That
   choice points at C/A vs B.
2. Should an executable asset be byte-exactly versioned and exportable with the
   coworker (`coworker.export`), so a coworker can be cloned fully self-contained?
3. Does Direction D change the calculus enough that a lighter A/C is sufficient
   short-term, with D as the longer-term fix?

## Non-Goals

- Replacing skills for genuinely reusable, multi-coworker playbooks — those stay
  workspace skills.
- Changing how read-only reference documents behave.
- Committing to an implementation in this document.
