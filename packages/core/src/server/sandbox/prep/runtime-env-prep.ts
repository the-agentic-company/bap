import { env } from "../../../env";
import { resolvePublicCallbackBaseUrl } from "../../../lib/worktree-routing";
import type { SandboxHandle } from "../core/types";

const RUNTIME_ENV_DIR = "/app/.cmdclaw";
const RUNTIME_ENV_JSON_PATH = `${RUNTIME_ENV_DIR}/runtime-env.json`;
const RUNTIME_ENV_SH_PATH = `${RUNTIME_ENV_DIR}/runtime-env.sh`;

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function resolveSandboxRuntimeAppUrl(): string {
  return resolvePublicCallbackBaseUrl({
    callbackBaseUrl: env.E2B_CALLBACK_BASE_URL,
    appUrl: env.APP_URL,
    viteAppUrl: env.VITE_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}

export function buildSandboxRuntimeEnvFiles(
  runtimeEnv: Record<string, string | null | undefined>,
): { json: string; shell: string; values: Record<string, string> } {
  const values = Object.fromEntries(
    Object.entries(runtimeEnv)
      .filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return key.length > 0 && typeof value === "string" && value.length > 0;
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  const shell = Object.entries(values)
    .map(([key, value]) => `export ${key}=${quoteShellValue(value)}`)
    .join("\n");

  return {
    json: JSON.stringify(values, null, 2),
    shell,
    values,
  };
}

export async function syncRuntimeEnvToSandbox(input: {
  sandbox: Pick<SandboxHandle, "exec">;
  runtimeEnv: Record<string, string | null | undefined>;
}): Promise<void> {
  const files = buildSandboxRuntimeEnvFiles(input.runtimeEnv);
  const jsonPayload = Buffer.from(files.json, "utf8").toString("base64");
  const shellPayload = Buffer.from(files.shell, "utf8").toString("base64");
  const command = [
    `mkdir -p ${escapeShellArg(RUNTIME_ENV_DIR)}`,
    "python3 - <<'PY'",
    "import base64",
    "from pathlib import Path",
    `json_payload = ${JSON.stringify(jsonPayload)}`,
    `shell_payload = ${JSON.stringify(shellPayload)}`,
    `json_path = Path(${JSON.stringify(RUNTIME_ENV_JSON_PATH)})`,
    `shell_path = Path(${JSON.stringify(RUNTIME_ENV_SH_PATH)})`,
    "for path, payload in ((json_path, json_payload), (shell_path, shell_payload)):",
    "  temp_path = Path(f'{path}.next')",
    "  temp_path.write_bytes(base64.b64decode(payload))",
    "  temp_path.replace(path)",
    "PY",
    `chmod 600 ${escapeShellArg(RUNTIME_ENV_JSON_PATH)} ${escapeShellArg(RUNTIME_ENV_SH_PATH)}`,
  ].join("\n");

  const result = await input.sandbox.exec(command, { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `Runtime env sync failed (exit=${result.exitCode}): ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}
