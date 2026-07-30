import {
  sanitizeClientDiagnosticText,
  sanitizeClientRoutePath,
  type ClientObservationPayload,
} from "@bap/core/lib/client-observation";

const MAX_ERROR_MESSAGE_LENGTH = 1_024;
const MAX_ERROR_STACK_LENGTH = 8_192;
function getErrorString(error: unknown, key: "name" | "message" | "stack"): string | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getBrowserState(): Pick<ClientObservationPayload, "pageVisibility" | "online"> {
  if (typeof document === "undefined" || typeof navigator === "undefined") {
    return { pageVisibility: "unknown", online: undefined };
  }

  const visibility = document.visibilityState;
  return {
    pageVisibility:
      visibility === "visible" || visibility === "hidden" || visibility === "prerender"
        ? visibility
        : "unknown",
    online: navigator.onLine,
  };
}

export function reportClientObservation(
  observation: Omit<ClientObservationPayload, "eventId" | "occurredAt"> &
    Partial<Pick<ClientObservationPayload, "eventId" | "occurredAt">>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const payload: ClientObservationPayload = {
    ...getBrowserState(),
    ...observation,
    eventId: observation.eventId ?? crypto.randomUUID(),
    occurredAt: observation.occurredAt ?? new Date().toISOString(),
  };

  const body = JSON.stringify({ observations: [payload] });
  const url = "/api/observability/client-observations";
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    if (sent) {
      return;
    }
  }

  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Client observations are best-effort and must never affect chat streaming.
  });
}

export function reportRootErrorObservation(error: unknown, eventId?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const errorName = getErrorString(error, "name") ?? "UnknownError";
    const rawMessage = getErrorString(error, "message") ?? String(error);
    const rawStack = getErrorString(error, "stack");
    const documentClasses = document.documentElement.classList;

    reportClientObservation({
      eventId,
      eventType: "ui.root_error",
      visibleErrorCode: "root_error",
      routePath: sanitizeClientRoutePath(window.location.pathname),
      errorName: sanitizeClientDiagnosticText(errorName, 128),
      errorMessage: sanitizeClientDiagnosticText(rawMessage, MAX_ERROR_MESSAGE_LENGTH),
      errorStack: rawStack
        ? sanitizeClientDiagnosticText(rawStack, MAX_ERROR_STACK_LENGTH)
        : undefined,
      clientBuildCommitSha: import.meta.env.VITE_CLIENT_BUILD_COMMIT_SHA ?? "unknown",
      browserLanguage: navigator.language,
      documentLanguage: document.documentElement.lang || undefined,
      browserTranslationActive:
        documentClasses.contains("translated-ltr") || documentClasses.contains("translated-rtl"),
      userAgent: navigator.userAgent,
    });
  } catch {
    // Root-error telemetry must never throw from the UI's final fallback.
  }
}
