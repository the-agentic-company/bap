#!/usr/bin/env bash
# Runs on SessionStart. If the cwd is a git worktree (not the main repo),
# install deps and run the worktree setup once. Idempotent via a sentinel file.
set -euo pipefail

git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0

# Resolve to absolute paths so the comparison is reliable.
git_dir=$(cd "$git_dir" && pwd)
common_dir=$(cd "$common_dir" && pwd)

if [ "$git_dir" = "$common_dir" ]; then
  exit 0
fi

sentinel=".claude/.worktree-setup-done"
if [ -f "$sentinel" ]; then
  exit 0
fi

echo "[claude-hook] worktree detected, running setup..." >&2
bun install
bun .agents/skills/worktree/cli/src/cli.ts setup

mkdir -p .claude
touch "$sentinel"
