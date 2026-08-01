import { trace } from "@opentelemetry/api";
import pino from "pino";

type LogLevel = "info" | "warn" | "error";

type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | Error
  | LogValue[]
  | { [key: string]: LogValue };

export type LogFields = Record<string, unknown>;

export type LoggerContext = {
  service?: string;
  source?: string;
  route?: string;
  rpcProcedure?: string;
  traceId?: string;
  generationId?: string;
  conversationId?: string;
  sandboxId?: string;
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
};

export type LoggerRuntimeConfig = {
  serviceName: string;
  env: string;
  vectorLogUrl?: string | null;
};

type NormalizedLogRecord = Record<string, unknown>;

type LogSink = (level: LogLevel, record: NormalizedLogRecord, message: string) => void;

export type OperationalLogger = {
  child(context: LoggerContext & LogFields): OperationalLogger;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
};

const SERVICE_NAMESPACE = "bap";
const TELEMETRY_SCHEMA_VERSION = "2026-05-22";
const MAX_SAFE_ARRAY_ITEMS = 25;
const MAX_SAFE_STRING_LENGTH = 512;
const MAX_ERROR_STACK_LENGTH = 8_192;
const MAX_PENDING_VECTOR_LOG_SHIPMENTS = 32;
const VECTOR_LOG_SHIPMENT_TIMEOUT_MS = 2_000;
const FORBIDDEN_FIELD_PATTERNS = [
  /(^|[._-])(authorization|cookie|password|secret|token|credential|api[_-]?key|oauth[_-]?code)($|[._-])/i,
  /(^|[._-])(prompt|model[_-]?output|request[_-]?body|response[_-]?body|body|content|document|email)($|[._-])/i,
  /(^|[._-])(tool[_-]?(input|result|payload)|file[_-]?contents?)($|[._-])/i,
];
const SAFE_FIELD_PREFIXES = ["app.phase."] as const;

let runtimeConfig: LoggerRuntimeConfig = {
  serviceName: "bap",
  env: process.env.NODE_ENV ?? "development",
  vectorLogUrl: null,
};

const pinoLogger = pino({
  base: undefined,
  messageKey: "msg",
  timestamp: pino.stdTimeFunctions.isoTime,
});

const pendingVectorLogShipments = new Set<Promise<void>>();

let logSink: LogSink = (level, record, message) => {
  pinoLogger[level](record, message);
  shipLogToVector(level, record, message);
};

export function configureLoggerRuntime(config: LoggerRuntimeConfig): void {
  runtimeConfig = {
    ...config,
    vectorLogUrl: config.vectorLogUrl ?? null,
  };
}

export function setLoggerSinkForTest(sink: LogSink | null): void {
  logSink =
    sink ??
    ((level, record, message) => {
      pinoLogger[level](record, message);
      shipLogToVector(level, record, message);
    });
}

function shipLogToVector(level: LogLevel, record: NormalizedLogRecord, message: string): void {
  const url = runtimeConfig.vectorLogUrl;
  if (!url || typeof fetch !== "function") {
    return;
  }

  // Render stdout is the durable fallback. Do not let a slow or unreachable
  // Vector endpoint retain an unbounded number of request bodies and async
  // contexts in the web process during a burst of operational logs.
  if (pendingVectorLogShipments.size >= MAX_PENDING_VECTOR_LOG_SHIPMENTS) {
    return;
  }

  const serviceName =
    typeof record["service.name"] === "string" ? record["service.name"] : runtimeConfig.serviceName;
  const env =
    typeof record["deployment.environment"] === "string"
      ? record["deployment.environment"]
      : runtimeConfig.env;
  const payload = {
    ...record,
    ts: new Date().toISOString(),
    service: serviceName,
    env,
    level,
    message,
  };

  const shipment = (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(VECTOR_LOG_SHIPMENT_TIMEOUT_MS),
      });
      await response.body?.cancel();
    } catch {
      // Logging must never break the caller. Render stdout remains the primary fallback.
    }
  })();

  pendingVectorLogShipments.add(shipment);
  void shipment.finally(() => {
    pendingVectorLogShipments.delete(shipment);
  });
}

function toDottedSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .replace(/__/g, "_")
    .split(".")
    .map((part) => part.replace(/^_+|_+$/g, "").toLowerCase())
    .filter(Boolean)
    .join(".");
}

function normalizeFieldKey(rawKey: string): string {
  switch (rawKey) {
    case "traceId":
      return "trace_id";
    case "spanId":
      return "span_id";
    case "rpcProcedure":
      return "rpc.method";
    case "generationId":
      return "bap.generation.id";
    case "conversationId":
      return "bap.conversation.id";
    case "sandboxId":
      return "bap.sandbox.id";
    case "sessionId":
      return "bap.session.id";
    case "userId":
      return "bap.user.id";
    case "workspaceId":
      return "bap.workspace.id";
    default:
      return toDottedSnakeCase(rawKey);
  }
}

function normalizeOperationalEventName(event: string | undefined): string | undefined {
  if (!event) {
    return undefined;
  }

  const normalized = toDottedSnakeCase(event);
  if (normalized.includes(".")) {
    return normalized;
  }

  const parts = normalized.split("_").filter(Boolean);
  if (parts.length <= 1) {
    return normalized;
  }
  return `${parts[0]}.${parts.slice(1).join("_")}`;
}

function isForbiddenTelemetryField(path: string): boolean {
  if (SAFE_FIELD_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  return FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(path));
}

function truncateLogString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

export function serializeErrorDiagnostic(error: Error): Record<string, unknown> {
  const serialized = pino.stdSerializers.err(error) as Record<string, unknown>;
  const diagnostic: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(serialized)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      diagnostic[key] = truncateLogString(
        value,
        key === "stack" ? MAX_ERROR_STACK_LENGTH : MAX_SAFE_STRING_LENGTH,
      );
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      diagnostic[key] = value;
    }
  }

  if (!diagnostic.type || diagnostic.type === "Object") {
    diagnostic.type = error.name;
  }
  diagnostic.message ??= truncateLogString(error.message, MAX_SAFE_STRING_LENGTH);
  if (error.stack && !diagnostic.stack) {
    diagnostic.stack = truncateLogString(error.stack, MAX_ERROR_STACK_LENGTH);
  }

  return diagnostic;
}

function normalizeLogValue(path: string, value: LogValue, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return truncateLogString(value, MAX_SAFE_STRING_LENGTH);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isErrorLike(value)) {
    return serializeErrorDiagnostic(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SAFE_ARRAY_ITEMS)
      .map((item, index) => normalizeLogValue(`${path}.${index}`, item, seen))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    const normalized: Record<string, unknown> = {};
    for (const [rawKey, nestedValue] of Object.entries(value)) {
      const key = toDottedSnakeCase(rawKey);
      if (!key) {
        continue;
      }
      const nestedPath = `${path}.${key}`;
      if (isForbiddenTelemetryField(nestedPath)) {
        continue;
      }
      const safeValue = normalizeLogValue(nestedPath, nestedValue as LogValue, seen);
      if (safeValue !== undefined) {
        normalized[key] = safeValue;
      }
    }
    return normalized;
  }
  return String(value);
}

export function normalizeLogFields(fields: LogFields = {}): NormalizedLogRecord {
  const normalized: NormalizedLogRecord = {};
  const seen = new WeakSet<object>();

  for (const [rawKey, value] of Object.entries(fields)) {
    const key = normalizeFieldKey(rawKey);
    if (!key || isForbiddenTelemetryField(key)) {
      continue;
    }
    const safeValue = normalizeLogValue(key, value as LogValue, seen);
    if (safeValue !== undefined) {
      normalized[key] = safeValue;
    }
  }

  return normalized;
}

function getActiveSpanIds(): { traceId?: string; spanId?: string } {
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();
  if (!spanContext) {
    return {};
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

function buildRuntimeFields(service?: string): NormalizedLogRecord {
  return {
    "service.name": service ?? runtimeConfig.serviceName,
    "service.namespace": SERVICE_NAMESPACE,
    "service.version": process.env.npm_package_version ?? "0.1.0",
    "deployment.environment": runtimeConfig.env,
    "bap.telemetry.schema_version": TELEMETRY_SCHEMA_VERSION,
    "bap.deployment.id": process.env.RENDER_SERVICE_ID ?? process.env.BAP_DEPLOYMENT_ID,
    "bap.deployment.commit_sha":
      process.env.RENDER_GIT_COMMIT ?? process.env.BAP_COMMIT_SHA,
    "bap.instance.id": process.env.BAP_INSTANCE_ID,
    "bap.worktree.slot": process.env.BAP_WORKTREE_SLOT,
  };
}

function normalizeLoggerContext(context: LoggerContext & LogFields): NormalizedLogRecord {
  return normalizeLogFields({
    service: context.service,
    source: context.source,
    route: context.route,
    "rpc.method": context.rpcProcedure,
    "bap.generation.id": context.generationId,
    "bap.conversation.id": context.conversationId,
    "bap.sandbox.id": context.sandboxId,
    "bap.session.id": context.sessionId,
    "bap.user.id": context.userId,
    "bap.workspace.id": context.workspaceId,
    ...context,
  });
}

function buildOperationalRecord(boundContext: NormalizedLogRecord, fields: LogFields) {
  const normalizedFields = normalizeLogFields(fields);
  const activeIds = getActiveSpanIds();
  const traceId =
    (typeof normalizedFields.trace_id === "string" ? normalizedFields.trace_id : undefined) ??
    (typeof normalizedFields.traceId === "string" ? normalizedFields.traceId : undefined) ??
    activeIds.traceId;
  const spanId = activeIds.spanId;
  const service =
    typeof normalizedFields.service === "string"
      ? normalizedFields.service
      : typeof boundContext.service === "string"
        ? boundContext.service
        : undefined;
  const event =
    typeof normalizedFields.event === "string"
      ? normalizeOperationalEventName(normalizedFields.event)
      : undefined;
  const err =
    normalizedFields.err ??
    normalizedFields.error ??
    (normalizedFields.cause && typeof normalizedFields.cause === "object"
      ? normalizedFields.cause
      : undefined);

  delete normalizedFields.service;
  delete normalizedFields.err;
  delete normalizedFields.error;

  return {
    ...buildRuntimeFields(service),
    "event.kind": "operational_log",
    ...boundContext,
    ...normalizedFields,
    ...(event ? { event } : {}),
    ...(err ? { err } : {}),
    ...(traceId ? { trace_id: traceId, traceId } : {}),
    ...(spanId ? { span_id: spanId, spanId } : {}),
  };
}

function inferMessage(fields: LogFields, fallback: string): string {
  if (typeof fields.message === "string" && fields.message.trim()) {
    return fields.message;
  }
  if (typeof fields.event === "string" && fields.event.trim()) {
    return fields.event.toLowerCase().replaceAll("_", " ");
  }
  return fallback;
}

function createLogger(boundContext: NormalizedLogRecord = {}): OperationalLogger {
  const write = (level: LogLevel, fields: LogFields, message?: string) => {
    const record = buildOperationalRecord(boundContext, fields);
    logSink(level, record, message ?? inferMessage(fields, "operational log"));
  };

  return {
    child(context) {
      return createLogger({
        ...boundContext,
        ...normalizeLoggerContext(context),
      });
    },
    info(fields, message) {
      write("info", fields, message);
    },
    warn(fields, message) {
      write("warn", fields, message);
    },
    error(fields, message) {
      write("error", fields, message);
    },
  };
}

export const logger: OperationalLogger = createLogger();

export function emitStructuredLog(
  level: LogLevel,
  record: NormalizedLogRecord,
  message: string,
): void {
  logSink(level, record, message);
}
