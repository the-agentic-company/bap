import { initializeObservabilityRuntime } from "@cmdclaw/core/server/utils/observability";

export function initializeWebObservabilityAtStartup(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  try {
    initializeObservabilityRuntime("cmdclaw-web");
  } catch (error) {
    console.error("[observability] Failed to initialize web observability runtime", error);
  }
}
