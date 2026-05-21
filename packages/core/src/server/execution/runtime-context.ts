import path from "path";
import { CMDCLAW_RUNTIME_CONTEXT_PATH, type RuntimeContextFile } from "../../lib/runtime-context";
import { syncRuntimeEnvToSandbox } from "../sandbox/prep/runtime-env-prep";

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function writeRuntimeContextToSandbox(
  runtimeSandbox: {
    exec: (
      command: string,
      opts?: { timeoutMs?: number; env?: Record<string, string> },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
  runtimeContext: RuntimeContextFile,
): Promise<void> {
  const payload = Buffer.from(JSON.stringify(runtimeContext, null, 2), "utf8").toString("base64");
  const targetPath = CMDCLAW_RUNTIME_CONTEXT_PATH;
  const targetDir = path.posix.dirname(targetPath);
  const tempPath = `${targetPath}.next`;
  const command = [
    `mkdir -p ${escapeShellArg(targetDir)}`,
    "python3 - <<'PY'",
    "import base64",
    "from pathlib import Path",
    `payload = ${JSON.stringify(payload)}`,
    `target_path = Path(${JSON.stringify(targetPath)})`,
    `temp_path = Path(${JSON.stringify(tempPath)})`,
    "temp_path.write_bytes(base64.b64decode(payload))",
    "temp_path.replace(target_path)",
    "PY",
  ].join("\n");
  const result = await runtimeSandbox.exec(command, { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `Runtime context write failed (exit=${result.exitCode}): ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

export async function writeRuntimeEnvToSandbox(
  runtimeSandbox: {
    exec: (
      command: string,
      opts?: { timeoutMs?: number; env?: Record<string, string> },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
  runtimeEnv: Record<string, string | null | undefined>,
): Promise<void> {
  await syncRuntimeEnvToSandbox({
    sandbox: runtimeSandbox,
    runtimeEnv,
  });
}
