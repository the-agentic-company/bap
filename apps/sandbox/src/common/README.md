# Common Sandbox Assets

Shared files used by both E2B and Daytona sandbox builds.

The sandbox runtime currently pins OpenCode to `1.3.0`.

## Contents

- **OpenCode Agent Definitions** live in `@bap/prompts` and are copied into `/app/.opencode/agents`.
- `skills/` - Built-in platform and integration skills.
- `plugins/` - OpenCode plugins shared by providers.
- `tools/` - OpenCode custom tools shared by providers.
- `opencode.json` - Base OpenCode configuration.
- `setup.sh` - Shared runtime setup script.
- `cli/` - Shared CLI setup assets.

Provider-specific build logic lives in:

- `src/e2b/` (E2B template definition and build scripts)
- `src/daytona/` (Daytona snapshot image and build scripts)
