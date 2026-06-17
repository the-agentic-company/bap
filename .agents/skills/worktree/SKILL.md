---
name: worktree
description: Guides agents through isolated Git worktree setup, lifecycle commands, process cleanup, and per-worktree local development state. Use when creating, starting, stopping, inspecting, cleaning up, or troubleshooting Git worktree development environments or when a repository includes a worktree lifecycle CLI.
---

# Worktree Environments

## Quick Start

1. Read [worktree_setup.md](worktree_setup.md) when it exists; it holds repository-specific commands, ports, environment variables, and service topology.
2. Prefer the repository's worktree lifecycle commands over manual Docker, process, or port management.
3. Inspect existing worktree state before starting new processes.
4. After fixing a failing worktree CLI command, rerun the same command and continue until the underlying issue is resolved.

## Workflow

- Detect a linked worktree by comparing `git rev-parse --git-dir` and `git rev-parse --git-common-dir`; different paths mean the checkout is a linked worktree.
- Use the setup command from `worktree_setup.md` to provision generated environment files, local services, and app processes.
- Use status, process, and environment commands from `worktree_setup.md` before changing running processes.
- Use lifecycle cleanup commands instead of deleting generated files or killing processes manually.
- Keep external hook or editor configuration in sync when moving files under `hooks/`.

## CLI Layout

- Deterministic lifecycle code belongs under `cli/`.
- Hook scripts belong under `hooks/`.
- Repository-specific operational detail belongs in `worktree_setup.md`; keep this file generic.
- Colocate tests with the CLI code as `*.test.ts`.
