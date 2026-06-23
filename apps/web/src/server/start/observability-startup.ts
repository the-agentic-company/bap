export async function initializeWebObservabilityAtStartup(): Promise<void> {
  if (typeof window !== "undefined" || process.env.NODE_ENV !== "production") {
    return;
  }

  try {
    const { initializeObservabilityRuntime } = await import("@bap/core/server/utils/observability");
    initializeObservabilityRuntime("bap-web");
  } catch (error) {
    console.error("[observability] Failed to initialize web observability runtime", error);
  }
}
