import { PROCESS_NAMES, type InstanceMetadata, type ProcessName } from "./cli-runtime";
import { loadProcesses } from "./cli-state";

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already gone.
    }
  }
}

export function terminateProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already gone.
  }
}

export async function waitForProcessesToExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidRunning(pid))) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return pids.filter((pid) => isPidRunning(pid));
}

export function getProcessEntries(metadata: InstanceMetadata): Array<{ name: ProcessName; pid: number }> {
  const stored = loadProcesses(metadata.instanceRoot);
  return PROCESS_NAMES.flatMap((name) => {
    const pid = stored[name];
    return typeof pid === "number" ? [{ name, pid }] : [];
  });
}

export function hasRunningTrackedProcesses(metadata: InstanceMetadata): boolean {
  return getProcessEntries(metadata).some((entry) => isPidRunning(entry.pid));
}
