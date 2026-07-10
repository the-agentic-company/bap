import path from "node:path";
import { fileURLToPath } from "node:url";
import { Image } from "@daytonaio/sdk";
import { OPENCODE_AGENT_DEFINITIONS_DIR } from "@bap/prompts";
import { BUN_VERSION, OPENCODE_PLUGIN_VERSION, OPENCODE_VERSION } from "../common/versions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SANDBOX_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const COMMON_ROOT = path.join(SANDBOX_ROOT, "src/common");
const MESSAGE_FORMAT_PACKAGE_ROOT = path.join(REPO_ROOT, "packages/message-format");
const runtimePackageJson = JSON.stringify({
  name: "sandbox-runtime",
  private: true,
  dependencies: {
    "@bap/message-format": "file:./packages/message-format",
    "@opencode-ai/plugin": OPENCODE_PLUGIN_VERSION,
  },
});
const installBunSteps = [
  "set -euo pipefail",
  'case "$(uname -m)" in x86_64|amd64) bun_target=bun-linux-x64 ;; aarch64|arm64) bun_target=bun-linux-aarch64 ;; *) echo "Unsupported Bun architecture: $(uname -m)" >&2; exit 1 ;; esac',
  'mkdir -p "$HOME/.bun/bin"',
  `curl --fail --show-error --location --retry 5 --retry-delay 2 --retry-all-errors --output /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/$bun_target.zip"`,
  "unzip -q /tmp/bun.zip -d /tmp",
  'install -m 0755 "/tmp/$bun_target/bun" "$HOME/.bun/bin/bun"',
  'ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun',
  'rm -rf /tmp/bun.zip "/tmp/$bun_target"',
  "bun --revision",
];
const installBun = `bash -lc '${installBunSteps.join("; ")}'`;

export const image = Image.debianSlim()
  .addLocalFile(`${COMMON_ROOT}/opencode.json`, "/app/opencode.json")
  .addLocalDir(OPENCODE_AGENT_DEFINITIONS_DIR, "/app/.opencode/agents")
  .addLocalDir(`${COMMON_ROOT}/plugins`, "/app/.opencode/plugins")
  .addLocalDir(`${COMMON_ROOT}/tools`, "/app/.opencode/tools")
  .addLocalDir(`${COMMON_ROOT}/lib`, "/app/.opencode/lib")
  .addLocalDir(`${COMMON_ROOT}/skills`, "/app/.claude/skills")
  .addLocalDir(`${COMMON_ROOT}/lib`, "/app/.claude/lib")
  .addLocalDir(MESSAGE_FORMAT_PACKAGE_ROOT, "/app/packages/message-format")
  .addLocalFile(`${COMMON_ROOT}/setup.sh`, "/app/setup.sh")
  .addLocalFile(`${COMMON_ROOT}/prewarm-opencode.sh`, "/app/prewarm-opencode.sh")
  .addLocalFile(`${COMMON_ROOT}/daytona-start.sh`, "/app/daytona-start.sh")
  .runCommands("apt-get update")
  .runCommands("apt-get install -y curl git ripgrep ca-certificates gnupg unzip s3fs mergerfs")
  .runCommands("apt-get install -y python3 python3-venv python3-pip python-is-python3")
  .runCommands("python -m pip install --break-system-packages reportlab matplotlib Pillow")
  .runCommands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -")
  .runCommands("apt-get install -y nodejs")
  .runCommands(
    "apt-get install -y libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0 libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 libfontconfig1 libdbus-1-3 libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 libxshmfence1 libgbm1",
  )
  .runCommands("npm i -g agent-browser")
  .runCommands("agent-browser install")
  .runCommands(installBun)
  .runCommands(`$HOME/.bun/bin/bun install -g opencode-ai@${OPENCODE_VERSION} tsx`)
  .runCommands("ln -s $HOME/.bun/bin/opencode /usr/local/bin/opencode")
  .runCommands("ln -s $HOME/.bun/bin/tsx /usr/local/bin/tsx")
  .runCommands("npm install -g @sandbox-agent/cli@0.2.x")
  .runCommands("sandbox-agent install-agent opencode")
  // Install TypeScript tool runtime deps resolved from /app/.opencode/tools/*.ts
  .runCommands(
    `bash -lc 'cd /app && printf %s ${JSON.stringify(runtimePackageJson)} > package.json && bun install'`,
  )
  .runCommands("mkdir -p $HOME/.config/opencode /app/.opencode $HOME/.cache/opencode")
  .runCommands("cp /app/opencode.json /app/.opencode/opencode.json")
  .runCommands("chmod +x /app/setup.sh")
  .runCommands("chmod +x /app/prewarm-opencode.sh")
  .runCommands("chmod +x /app/daytona-start.sh")
  .runCommands("/app/setup.sh")
  // Prewarm OpenCode project init for /app so fresh sandboxes skip the cold
  // first-call cost (plugin dependency install, models.dev catalog fetch, and
  // bun transpile caches all land in the snapshot).
  .runCommands(
    "timeout --kill-after=5s 180s /app/prewarm-opencode.sh || echo '[daytona] OpenCode prewarm skipped: timed out or failed'",
  )
  .workdir("/app")
  .entrypoint(["/bin/bash", "/app/daytona-start.sh"]);
