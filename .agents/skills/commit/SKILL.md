---
name: commit
description: Scoped commit workflow with a bundled committer script that prevents accidental broad staging. Use when the user asks to commit, commit all, create a git commit, or handle commit-time staging in this repository.
---

# Commit

## Commit policy

- Do not commit unless the user explicitly asks.
- Create commits with the bundled `scripts/committer "<msg>" <file...>`; avoid manual `git add`/`git commit` so staging stays scoped.
- From the repository root, run `.agents/skills/commit/scripts/committer "<msg>" <file...>`.
- Follow concise, action-oriented commit messages, for example `CLI: add verbose flag to send`.
- Group related changes; avoid bundling unrelated refactors.
- **Multi-agent safety:** When the user says "commit," scope to your changes only.
- **Multi-agent safety:** When the user says "commit all," commit everything in grouped chunks.
- **Multi-agent safety:** When you see unrecognized files, keep going; focus on your changes and commit only those.
- If you have an issue with lefthook, you can bypass it if there is no issue in the files you edited.

Always prefer Big Bang Rewrite when doing a big refactoring; do not keep backward compatibility or add fallback logic.

## Bundled committer

The helper lives at `scripts/committer` inside this skill folder. It unstages the repo, stages only the listed files, rejects `.` and `node_modules`, and commits the scoped file list.

If a stale Git index lock blocks the commit, retry with `--force`:

```sh
.agents/skills/commit/scripts/committer --force "<msg>" <file...>
```
