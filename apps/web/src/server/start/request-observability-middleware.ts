import { createMiddleware } from "@tanstack/react-start";

/**
 * Lightweight request observability hook.
 *
 * Idempotently ensures the web observability runtime is initialized while handling requests.
 * Startup initialization lives in `observability-startup.ts`; this remains as a request-time
 * guard in case the runtime is loaded through an alternate server entry.
 *
 * Initialization is idempotent (initializeObservabilityRuntime guards against double init).
 */
export const requestObservabilityMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    if (process.env.NODE_ENV === "production") {
      try {
        const { initializeObservabilityRuntime } =
          await import("@cmdclaw/core/server/utils/observability");
        initializeObservabilityRuntime("cmdclaw-web");
      } catch (error) {
        console.error("[observability] Failed to ensure web observability runtime", error);
      }
    }

    return next();
  },
);
