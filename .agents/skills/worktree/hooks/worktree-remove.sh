#!/usr/bin/env bash
# Runs on WorktreeRemove. Reads the worktree path from the hook JSON input
# on stdin and runs the bundled worktree destroy command inside it.
#
# WorktreeRemove fires when:
#   - a subagent with isolation:"worktree" finishes, or
#   - a Claude Code session opened with --worktree exits.
# It does NOT fire for worktrees removed manually via `git worktree remove`.
#
# We surface failures via:
#   - non-zero exit code (Claude shows a hook error in the transcript)
#   - stderr (printed loudly with markers)
#   - a log file at $CLAUDE_PROJECT_DIR/.claude/worktree-destroy.log so a
#     failure can be inspected even if the in-UI message is missed.
set -uo pipefail

input=$(cat)
wt=$(printf '%s' "$input" | jq -r '.worktree_path // empty')

log_dir="${CLAUDE_PROJECT_DIR:-$PWD}/.claude"
log_file="$log_dir/worktree-destroy.log"
mkdir -p "$log_dir"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

if [ -z "$wt" ]; then
  echo "[claude-hook] WorktreeRemove: missing worktree_path in input" >&2
  echo "$(ts) ERROR missing worktree_path; input=$input" >> "$log_file"
  exit 1
fi

if [ ! -d "$wt" ]; then
  # Worktree dir is already gone — nothing to clean up. Not an error.
  echo "$(ts) SKIP $wt (already removed)" >> "$log_file"
  exit 0
fi

echo "[claude-hook] cleaning up worktree at $wt..." >&2
echo "$(ts) START $wt" >> "$log_file"

if ( cd "$wt" && bun .agents/skills/worktree/cli/src/cli.ts destroy ) >>"$log_file" 2>&1; then
  echo "$(ts) OK    $wt" >> "$log_file"
  exit 0
fi

rc=$?
echo "$(ts) FAIL  $wt (exit $rc)" >> "$log_file"
echo "[claude-hook] !! worktree:destroy FAILED for $wt (exit $rc)" >&2
echo "[claude-hook] !! see $log_file for full output" >&2
echo "[claude-hook] !! you may need to clean up manually:" >&2
echo "[claude-hook] !!   cd $wt && bun .agents/skills/worktree/cli/src/cli.ts destroy" >&2
exit "$rc"
