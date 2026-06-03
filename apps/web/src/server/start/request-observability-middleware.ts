import { createMiddleware } from "@tanstack/react-start";

/**
 * Lightweight request observability hook.
 *
 * Ensures the web observability runtime is initialized before the first request is served
 * in the production Node runtime, then passes the request through untouched. Heavy logging
 * and metrics stay in the oRPC layer and individual handlers; this is only the request-wide
 * bootstrap/light-hook surface the migration spec calls for.
 *
 * Initialization is idempotent (initializeObservabilityRuntime guards against double init),
 * so this complements — and does not replace — startup initialization in
 * src/instrumentation*.ts.
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
