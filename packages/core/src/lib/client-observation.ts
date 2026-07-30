import { z } from "zod";

const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:["']?)(authorization|cookie|password|secret|token|credential|api[_-]?key|oauth[_-]?code)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[^\s]+/gi;
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s)]+/g;
const OPAQUE_PATH_SEGMENT_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,})$/i;

export function sanitizeClientRoutePath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] || "/";
  return pathname
    .split("/")
    .map((segment) =>
      OPAQUE_PATH_SEGMENT_PATTERN.test(segment) ? "[redacted-id]" : segment,
    )
    .join("/");
}

export function sanitizeClientDiagnosticText(value: string, maxLength: number): string {
  const redacted = value
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(ABSOLUTE_URL_PATTERN, (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        return `${url.origin}${sanitizeClientRoutePath(url.pathname)}`;
      } catch {
        return "[URL]";
      }
    })
    .replaceAll("\u0000", "");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}…` : redacted;
}

export const CLIENT_OBSERVATION_TYPES = [
  "generation.stream.opened",
  "generation.stream.closed",
  "generation.stream.error",
  "generation.stream.reconnected",
  "generation.stream.first_event",
  "generation.stream.done",
  "generation.visible_error",
  "ui.root_error",
] as const;

export const clientObservationSchema = z
  .object({
  eventId: z.string().min(8).max(128),
  eventType: z.enum(CLIENT_OBSERVATION_TYPES),
  occurredAt: z.string().datetime().optional(),
  generationId: z.string().min(1).max(128).optional(),
  conversationId: z.string().min(1).max(128).optional(),
  traceId: z.string().min(8).max(128).optional(),
  streamAttempt: z.number().int().min(0).max(100).optional(),
  elapsedMs: z.number().min(0).max(24 * 60 * 60 * 1000).optional(),
  visibleErrorCode: z.string().min(1).max(128).optional(),
  closeReason: z.enum(["done", "cancelled", "aborted", "error", "unknown"]).optional(),
  pageVisibility: z.enum(["visible", "hidden", "prerender", "unknown"]).optional(),
  online: z.boolean().optional(),
  routePath: z.string().min(1).max(512).optional(),
  errorName: z.string().min(1).max(128).optional(),
  errorMessage: z.string().min(1).max(1_024).optional(),
  errorStack: z.string().min(1).max(8_192).optional(),
  clientBuildCommitSha: z.string().min(1).max(128).optional(),
  browserLanguage: z.string().min(1).max(64).optional(),
  documentLanguage: z.string().min(1).max(64).optional(),
  browserTranslationActive: z.boolean().optional(),
    userAgent: z.string().min(1).max(512).optional(),
  })
  .superRefine((observation, context) => {
    const rootFields = [
      "routePath",
      "errorName",
      "errorMessage",
      "clientBuildCommitSha",
      "userAgent",
    ] as const;
    if (observation.eventType === "ui.root_error") {
      for (const field of rootFields) {
        if (!observation[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required for ui.root_error`,
          });
        }
      }
      return;
    }
    for (const field of [...rootFields, "errorStack"] as const) {
      if (observation[field] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is only allowed for ui.root_error`,
        });
      }
    }
  });

export type ClientObservationPayload = z.infer<typeof clientObservationSchema>;
