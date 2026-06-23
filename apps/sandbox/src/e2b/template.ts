import { Template } from "e2b";
import { OPENCODE_VERSION } from "../common/versions";

const COMMON_ROOT = "apps/sandbox/src/common";
const OPENCODE_AGENT_DEFINITIONS_ROOT = "packages/prompts/src/assets/opencode-agents";
const OPENCODE_PORT = 4096;
const SANDBOX_AGENT_PORT = 2468;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

const templateStartScript = [
  "set -euo pipefail",
  "cd /app",
  "mkdir -p /app/.bap",
  "export OPENCODE_CONFIG=/app/opencode.json",
  "export OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true",
  "opencode models openai --refresh >/tmp/opencode-model-refresh.log 2>&1 || true",
  `opencode serve --hostname 0.0.0.0 --port ${OPENCODE_PORT} >/tmp/opencode.log 2>&1 &`,
  "opencode_pid=$!",
  `sandbox-agent server --no-token --host 0.0.0.0 --port ${SANDBOX_AGENT_PORT} >/tmp/sandbox-agent.log 2>&1 &`,
  "sandbox_agent_pid=$!",
  'cleanup() { kill "$opencode_pid" "$sandbox_agent_pid" 2>/dev/null || true; }',
  "trap cleanup EXIT INT TERM",
  'wait -n "$opencode_pid" "$sandbox_agent_pid"',
  "status=$?",
  "cleanup",
  'wait "$opencode_pid" "$sandbox_agent_pid" 2>/dev/null || true',
  "exit $status",
].join("\n");

const templateReadyScript = [
  "set -uo pipefail",
  "for _ in $(seq 1 120); do",
  "if " +
    [
      `curl -fsS http://127.0.0.1:${OPENCODE_PORT}/health >/dev/null 2>&1`,
      `curl -fsS http://127.0.0.1:${SANDBOX_AGENT_PORT}/v1/health >/dev/null 2>&1`,
    ].join(" && ") +
    "; then exit 0; fi",
  "sleep 0.25",
  "done",
  "echo 'OpenCode log:' >&2",
  "tail -n 50 /tmp/opencode.log >&2 || true",
  "echo 'Sandbox Agent log:' >&2",
  "tail -n 50 /tmp/sandbox-agent.log >&2 || true",
  "exit 1",
].join("\n");

const templateStartCommand = `bash -lc ${shellQuote(templateStartScript)}`;
const templateReadyCommand = `bash -lc ${shellQuote(templateReadyScript)}`;

export const template = Template({
  fileContextPath: "../..",
})
  .fromUbuntuImage("24.04")
  // Install base dependencies
  .aptInstall(["curl", "git", "ripgrep", "ca-certificates", "gnupg", "unzip"])
  // Install Python 3 (Ubuntu 24.04 has Python 3.12)
  .aptInstall(["python3", "python3-venv", "python3-pip", "python-is-python3"])
  // Install Node.js 22.x LTS (needed for packages with node shebang)
  .runCmd(
    "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs",
  )
  // Install agent-browser and preload Chromium
  .npmInstall(["agent-browser"], { g: true })
  .runCmd("agent-browser install --with-deps")
  // Install bun and create symlinks in /usr/local/bin for PATH availability
  .runCmd("curl -fsSL https://bun.sh/install | bash")
  .runCmd("sudo ln -s $HOME/.bun/bin/bun /usr/local/bin/bun")
  // Install OpenCode runtime + tsx for TypeScript CLI tools
  .runCmd(`$HOME/.bun/bin/bun install -g opencode-ai@${OPENCODE_VERSION} tsx`)
  .runCmd("sudo ln -s $HOME/.bun/bin/opencode /usr/local/bin/opencode")
  .runCmd("sudo ln -s $HOME/.bun/bin/tsx /usr/local/bin/tsx")
  // Install Agent Sandbox SDK runtime (OpenCode compatibility at /opencode)
  .runCmd("sudo npm install -g @sandbox-agent/cli@0.2.x")
  .runCmd("sandbox-agent install-agent opencode")
  .setWorkdir("/app")
  // Copy OpenCode config, plugins, and custom tools
  .copy(`${COMMON_ROOT}/opencode.json`, "/app/opencode.json")
  .runCmd(
    "mkdir -p /app/.opencode/agents /app/.opencode/plugins /app/.opencode/tools /app/.opencode/lib",
  )
  .copy(OPENCODE_AGENT_DEFINITIONS_ROOT, "/app/.opencode/agents")
  .copy(`${COMMON_ROOT}/plugins`, "/app/.opencode/plugins")
  .copy(`${COMMON_ROOT}/tools`, "/app/.opencode/tools")
  .copy(`${COMMON_ROOT}/lib`, "/app/.opencode/lib")
  // Prewarm both runtimes to avoid first-request overhead
  .runCmd("mkdir -p $HOME/.config/opencode /app/.opencode $HOME/.cache/opencode")
  .runCmd("cp /app/opencode.json /app/.opencode/opencode.json")
  .runCmd(
    'bash -lc \'set -euo pipefail; export OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true; opencode models openai --refresh >/tmp/opencode-model-refresh.log 2>&1 || true; opencode serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode-prewarm.log 2>&1 & pid=$!; ok=0; for i in $(seq 1 120); do if curl -fsS http://127.0.0.1:4096/health >/dev/null 2>&1; then ok=1; break; fi; sleep 0.25; done; kill $pid || true; wait $pid || true; test "$ok" = "1"\'',
  )
  .runCmd(
    'bash -lc \'set -euo pipefail; sandbox-agent server --no-token --host 127.0.0.1 --port 2468 > /tmp/sandbox-agent-prewarm.log 2>&1 & pid=$!; ok=0; for i in $(seq 1 120); do if curl -fsS http://127.0.0.1:2468/v1/health >/dev/null 2>&1; then ok=1; break; fi; sleep 0.25; done; kill $pid || true; wait $pid || true; test "$ok" = "1"\'',
  )
  // Copy skills into .claude/skills
  .runCmd("mkdir -p /app/.agents /app/.claude")
  .copy(`${COMMON_ROOT}/skills`, "/app/.agents/skills")
  .copy(`${COMMON_ROOT}/lib`, "/app/.agents/lib")
  // symlink for claude
  .runCmd("ln -sfn /app/.agents/skills /app/.claude/skills")
  // Copy setup script
  .copy(`${COMMON_ROOT}/setup.sh`, "/app/setup.sh")
  // allow to install packages from pip
  .runCmd(
    'mkdir -p $HOME/.config/pip && echo -e "[global]\nbreak-system-packages = true" > $HOME/.config/pip/pip.conf',
  )
  .runCmd("/app/setup.sh")
  .setStartCmd(templateStartCommand, templateReadyCommand);
