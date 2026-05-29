import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type IMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import pino from "pino";
import {
  context,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Context,
  type Counter,
  type Histogram,
  type ObservableResult,
  type SpanKind,
  type Tracer,
} from "@opentelemetry/api";

export type ObservabilityContext = {
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
};

type LogLevel = "info" | "warn" | "error";

type MetricValue = string | number | boolean | undefined | null;

type MetricAttributes = Record<string, MetricValue>;

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export type CanonicalServiceEventInput = {
  level?: LogLevel;
  eventName: string;
  operationName: string;
  eventId: string;
  outcome: string;
  attributes?: Record<string, CanonicalValue>;
  context?: ObservabilityContext;
  timestamp?: Date;
};

export type ClientObservationInput = {
  eventId: string;
  eventType: string;
  attributes?: Record<string, CanonicalValue>;
  context?: ObservabilityContext;
  timestamp?: Date;
};

type TraceCarrier = Record<string, string>;

type ConsoleMethod = "log" | "info" | "warn" | "error";

type EnvLookup = Record<string, string | undefined>;

export type ObservabilityVectorUrls = {
  logUrl: string;
  metricsUrl: string;
  tracesUrl: string;
};

type InstrumentRegistry = {
  counters: Map<string, Counter>;
  histograms: Map<string, Histogram>;
  observableGauges: Set<string>;
};

type ObservabilityRuntimeState = {
  initialized: boolean;
  serviceName: string;
  env: string;
  vectorLogUrl: string;
  vectorMetricsUrl: string;
  vectorTracesUrl: string;
  tracer: Tracer;
  tracerProvider: NodeTracerProvider | null;
  meterProvider: MeterProvider | null;
  metricReader: IMetricReader | null;
  spanProcessor: SpanProcessor | null;
  instruments: InstrumentRegistry;
  consolePatched: boolean;
  pendingLogExports: Set<Promise<void>>;
};

const SERVICE_NAMESPACE = "cmdclaw";
const INSTRUMENTATION_SCOPE = "cmdclaw.observability";
const QUEUE_TRACE_CONTEXT_KEY = "__trace_context";
const CONSOLE_METHODS: ConsoleMethod[] = ["log", "info", "warn", "error"];
const DEFAULT_OBSERVABILITY_HOST = "127.0.0.1";
const ATTR_DEPLOYMENT_ENVIRONMENT = "deployment.environment" as const;
const ATTR_CMDCLAW_INSTANCE_ID = "cmdclaw_instance_id" as const;
const ATTR_CMDCLAW_WORKTREE_SLOT = "cmdclaw_worktree_slot" as const;
const TELEMETRY_SCHEMA_VERSION = "2026-05-22";
const FORBIDDEN_FIELD_PATTERNS = [
  /(^|[._-])(authorization|cookie|password|secret|token|credential|api[_-]?key|oauth[_-]?code)($|[._-])/i,
  /(^|[._-])(prompt|model[_-]?output|request[_-]?body|response[_-]?body|body|content|document|email)($|[._-])/i,
  /(^|[._-])(tool[_-]?(input|result|payload)|file[_-]?contents?)($|[._-])/i,
];
const SAFE_FIELD_PREFIXES = ["cmdclaw.phase."] as const;
const MAX_SAFE_ARRAY_ITEMS = 25;
const MAX_SAFE_STRING_LENGTH = 512;
const MAX_ERROR_STACK_LENGTH = 8_192;

const globalState = globalThis as typeof globalThis & {
  __cmdclawObservabilityState?: ObservabilityRuntimeState;
  __cmdclawObservabilityOriginalConsole?: Partial<Record<ConsoleMethod, typeof console.log>>;
};

const runtimeState: ObservabilityRuntimeState =
  globalState.__cmdclawObservabilityState ??
  (() => {
    const initial = {
      initialized: false,
      serviceName: "cmdclaw",
      env: process.env.NODE_ENV ?? "development",
      vectorLogUrl: `http://${DEFAULT_OBSERVABILITY_HOST}:8686/logs`,
      vectorMetricsUrl: `http://${DEFAULT_OBSERVABILITY_HOST}:4318/v1/metrics`,
      vectorTracesUrl: `http://${DEFAULT_OBSERVABILITY_HOST}:4318/v1/traces`,
      tracer: trace.getTracer(INSTRUMENTATION_SCOPE),
      tracerProvider: null,
      meterProvider: null,
      metricReader: null,
      spanProcessor: null,
      instruments: {
        counters: new Map<string, Counter>(),
        histograms: new Map<string, Histogram>(),
        observableGauges: new Set<string>(),
      },
      consolePatched: false,
      pendingLogExports: new Set<Promise<void>>(),
    } satisfies ObservabilityRuntimeState;
    globalState.__cmdclawObservabilityState = initial;
    return initial;
  })();

runtimeState.tracerProvider ??= null;
runtimeState.pendingLogExports ??= new Set<Promise<void>>();

function isObservabilityDisabled(): boolean {
  return (process.env.NODE_ENV ?? "development") === "test";
}

function getPendingLogExports(): Set<Promise<void>> {
  runtimeState.pendingLogExports ??= new Set<Promise<void>>();
  return runtimeState.pendingLogExports;
}

function getValueFromEnvRecord(env: EnvLookup, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function buildVectorUrlFromEnv(
  path: string,
  env: EnvLookup,
  options: { defaultPort?: string; fullUrlEnvNames?: string[]; portEnvNames?: string[] } = {},
): string {
  const { defaultPort, fullUrlEnvNames = [], portEnvNames = [] } = options;

  const fullUrl = getValueFromEnvRecord(env, ...fullUrlEnvNames);
  if (fullUrl) {
    return fullUrl;
  }

  const hostport = getValueFromEnvRecord(
    env,
    "CMDCLAW_VECTOR_HOSTPORT",
    "CMDCLAW_OBSERVABILITY_HOSTPORT",
  );
  if (hostport) {
    return `http://${hostport}${path}`;
  }

  const host =
    getValueFromEnvRecord(env, "CMDCLAW_VECTOR_HOST", "CMDCLAW_OBSERVABILITY_HOST") ??
    DEFAULT_OBSERVABILITY_HOST;
  const port = getValueFromEnvRecord(env, ...portEnvNames);
  if (port) {
    return `http://${host}:${port}${path}`;
  }

  if (path === "/logs") {
    return `http://${host}:8686${path}`;
  }

  return `http://${host}:${defaultPort ?? "4318"}${path}`;
}

export function resolveObservabilityVectorUrls(
  env: EnvLookup = process.env as EnvLookup,
): ObservabilityVectorUrls {
  return {
    logUrl: buildVectorUrlFromEnv("/logs", env, {
      fullUrlEnvNames: ["CMDCLAW_VECTOR_LOG_URL"],
      portEnvNames: ["CMDCLAW_VECTOR_LOG_PORT"],
    }),
    metricsUrl: buildVectorUrlFromEnv("/v1/metrics", env, {
      fullUrlEnvNames: ["CMDCLAW_VECTOR_METRICS_URL"],
      portEnvNames: ["CMDCLAW_VECTOR_OTLP_HTTP_PORT", "CMDCLAW_OTEL_HTTP_PORT"],
    }),
    tracesUrl: buildVectorUrlFromEnv("/v1/traces", env, {
      fullUrlEnvNames: ["CMDCLAW_VECTOR_TRACES_URL"],
      portEnvNames: ["CMDCLAW_VECTOR_TRACES_PORT"],
      defaultPort: "5318",
    }),
  };
}

function trimUndefinedAttributes(attributes?: MetricAttributes): Attributes | undefined {
  if (!attributes) {
    return undefined;
  }

  const entries = Object.entries(attributes).filter((entry) => {
    const value = entry[1];
    return value !== undefined && value !== null;
  });
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Attributes;
}

function withRuntimeMetricAttributes(attributes?: MetricAttributes): MetricAttributes {
  return {
    service_name: runtimeState.serviceName,
    service_namespace: SERVICE_NAMESPACE,
    deployment_environment: runtimeState.env,
    ...attributes,
  };
}

function toDottedSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .replace(/__/g, "_")
    .replace(/_/g, "_")
    .split(".")
    .map((part) => part.replace(/^_+|_+$/g, "").toLowerCase())
    .filter(Boolean)
    .join(".");
}

function isForbiddenTelemetryField(path: string): boolean {
  if (SAFE_FIELD_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  return FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(path));
}

function normalizeCanonicalValue(path: string, value: CanonicalValue): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_SAFE_STRING_LENGTH
      ? `${value.slice(0, MAX_SAFE_STRING_LENGTH)}…`
      : value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SAFE_ARRAY_ITEMS)
      .map((item, index) => normalizeCanonicalValue(`${path}.${index}`, item))
      .filter((item) => item !== undefined);
  }

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
    const safeValue = normalizeCanonicalValue(nestedPath, nestedValue);
    if (safeValue !== undefined) {
      normalized[key] = safeValue;
    }
  }
  return normalized;
}

export function normalizeTelemetryAttributes(
  attributes: Record<string, CanonicalValue> = {},
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(attributes)) {
    const key = toDottedSnakeCase(rawKey);
    if (!key || isForbiddenTelemetryField(key)) {
      continue;
    }
    const normalizedValue = normalizeCanonicalValue(key, value);
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue;
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

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, createLogJsonReplacer());
  } catch {
    return String(value);
  }
}

function truncateLogString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
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

  diagnostic.type ??= error.name;
  diagnostic.message ??= truncateLogString(error.message, MAX_SAFE_STRING_LENGTH);
  if (error.stack && !diagnostic.stack) {
    diagnostic.stack = truncateLogString(error.stack, MAX_ERROR_STACK_LENGTH);
  }

  return diagnostic;
}

function createLogJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();

  return (_key, value) => {
    if (isErrorLike(value)) {
      return serializeErrorDiagnostic(value);
    }
    if (value && typeof value === "object") {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  };
}

function maybeParseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function buildConsoleMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (isErrorLike(arg)) {
        const diagnostic = serializeErrorDiagnostic(arg);
        const type = typeof diagnostic.type === "string" ? diagnostic.type : arg.name;
        const message =
          typeof diagnostic.message === "string" && diagnostic.message.trim()
            ? diagnostic.message
            : String(arg);
        return `${type}: ${message}`;
      }
      return safeStringify(arg);
    })
    .join(" ")
    .trim();
}

export function buildConsolePayload(
  level: ConsoleMethod,
  args: unknown[],
): Record<string, unknown> {
  const firstString = args.length === 1 && typeof args[0] === "string" ? args[0] : null;
  const parsedPayload = firstString ? maybeParseJsonObject(firstString) : null;
  const activeIds = getActiveSpanIds();

  if (parsedPayload) {
    const traceId =
      (typeof parsedPayload.traceId === "string" ? parsedPayload.traceId : undefined) ??
      (typeof parsedPayload.trace_id === "string" ? parsedPayload.trace_id : undefined) ??
      activeIds.traceId;
    const spanId =
      (typeof parsedPayload.spanId === "string" ? parsedPayload.spanId : undefined) ??
      (typeof parsedPayload.span_id === "string" ? parsedPayload.span_id : undefined) ??
      activeIds.spanId;

    return {
      ts: typeof parsedPayload.ts === "string" ? parsedPayload.ts : new Date().toISOString(),
      level: typeof parsedPayload.level === "string" ? parsedPayload.level : level,
      service:
        typeof parsedPayload.service === "string"
          ? parsedPayload.service
          : runtimeState.serviceName,
      env: typeof parsedPayload.env === "string" ? parsedPayload.env : runtimeState.env,
      instanceId:
        typeof parsedPayload.instanceId === "string"
          ? parsedPayload.instanceId
          : process.env.CMDCLAW_INSTANCE_ID,
      worktreeSlot:
        typeof parsedPayload.worktreeSlot === "string"
          ? parsedPayload.worktreeSlot
          : process.env.CMDCLAW_WORKTREE_SLOT,
      ...parsedPayload,
      ...(traceId ? { traceId, trace_id: traceId } : {}),
      ...(spanId ? { spanId, span_id: spanId } : {}),
    };
  }

  const message = buildConsoleMessage(args);
  const errorDiagnostics = args.filter(isErrorLike).map(serializeErrorDiagnostic);

  return {
    ts: new Date().toISOString(),
    level,
    service: runtimeState.serviceName,
    env: runtimeState.env,
    instanceId: process.env.CMDCLAW_INSTANCE_ID,
    worktreeSlot: process.env.CMDCLAW_WORKTREE_SLOT,
    message,
    args: args.map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.parse(safeStringify(arg));
      } catch {
        return safeStringify(arg);
      }
    }),
    ...(errorDiagnostics[0] ? { err: errorDiagnostics[0] } : {}),
    ...(errorDiagnostics.length > 1 ? { errs: errorDiagnostics } : {}),
    ...(activeIds.traceId ? { traceId: activeIds.traceId, trace_id: activeIds.traceId } : {}),
    ...(activeIds.spanId ? { spanId: activeIds.spanId, span_id: activeIds.spanId } : {}),
  };
}

function forwardLogPayload(payload: Record<string, unknown>): void {
  if (isObservabilityDisabled()) {
    return;
  }

  const exportPromise = fetch(runtimeState.vectorLogUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then(() => undefined)
    .catch(() => {
      // Telemetry export is best effort and must not recursively log its own failures.
    })
    .finally(() => {
      getPendingLogExports().delete(exportPromise);
    });

  getPendingLogExports().add(exportPromise);
}

function patchConsole(): void {
  if (runtimeState.consolePatched) {
    return;
  }

  const originals = globalState.__cmdclawObservabilityOriginalConsole ?? {};
  globalState.__cmdclawObservabilityOriginalConsole = originals;

  for (const method of CONSOLE_METHODS) {
    if (!originals[method]) {
      originals[method] = console[method].bind(console);
    }

    console[method] = ((...args: unknown[]) => {
      originals[method]?.(...args);
      forwardLogPayload(buildConsolePayload(method === "log" ? "info" : method, args));
    }) as typeof console.log;
  }

  runtimeState.consolePatched = true;
}

function getOrCreateCounter(name: string, description?: string): Counter {
  const existing = runtimeState.instruments.counters.get(name);
  if (existing) {
    return existing;
  }

  const counter = metrics
    .getMeter(INSTRUMENTATION_SCOPE)
    .createCounter(name, description ? { description } : undefined);
  runtimeState.instruments.counters.set(name, counter);
  return counter;
}

function getOrCreateHistogram(name: string, description?: string): Histogram {
  const existing = runtimeState.instruments.histograms.get(name);
  if (existing) {
    return existing;
  }

  const histogram = metrics
    .getMeter(INSTRUMENTATION_SCOPE)
    .createHistogram(name, description ? { description } : undefined);
  runtimeState.instruments.histograms.set(name, histogram);
  return histogram;
}

function buildResource(serviceName: string) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_NAMESPACE]: SERVICE_NAMESPACE,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: runtimeState.env,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
    [ATTR_CMDCLAW_INSTANCE_ID]: process.env.CMDCLAW_INSTANCE_ID,
    [ATTR_CMDCLAW_WORKTREE_SLOT]: process.env.CMDCLAW_WORKTREE_SLOT,
  });
}

export function initializeObservabilityRuntime(serviceName: string): void {
  runtimeState.serviceName = serviceName;
  runtimeState.env = process.env.NODE_ENV ?? "development";
  const vectorUrls = resolveObservabilityVectorUrls();
  runtimeState.vectorLogUrl = vectorUrls.logUrl;
  runtimeState.vectorMetricsUrl = vectorUrls.metricsUrl;
  runtimeState.vectorTracesUrl = vectorUrls.tracesUrl;

  if (isObservabilityDisabled()) {
    return;
  }

  patchConsole();

  if (runtimeState.initialized) {
    return;
  }

  const resource = buildResource(serviceName);
  const spanProcessor = new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: runtimeState.vectorTracesUrl,
      timeoutMillis: 1000,
    }),
    {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 1000,
    },
  );

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [spanProcessor],
  });
  tracerProvider.register({
    contextManager: new AsyncLocalStorageContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: runtimeState.vectorMetricsUrl,
      timeoutMillis: 1000,
    }),
    exportIntervalMillis: 5000,
    exportTimeoutMillis: 1000,
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  registerObservableGauge(
    "cmdclaw_runtime_up",
    (observe) => {
      observe(1);
    },
    "Whether the current CmdClaw runtime process is alive and exporting telemetry.",
  );

  runtimeState.initialized = true;
  runtimeState.tracer = trace.getTracer(INSTRUMENTATION_SCOPE);
  runtimeState.tracerProvider = tracerProvider;
  runtimeState.meterProvider = meterProvider;
  runtimeState.metricReader = metricReader;
  runtimeState.spanProcessor = spanProcessor;
}

export async function shutdownObservabilityRuntime(): Promise<void> {
  if (isObservabilityDisabled() || !runtimeState.initialized) {
    return;
  }

  await Promise.allSettled([
    runtimeState.spanProcessor?.forceFlush(),
    runtimeState.metricReader?.forceFlush(),
  ]);
  await Promise.allSettled(Array.from(getPendingLogExports()));
  await Promise.allSettled([
    runtimeState.tracerProvider?.shutdown(),
    runtimeState.meterProvider?.shutdown(),
  ]);

  runtimeState.initialized = false;
  runtimeState.tracerProvider = null;
  runtimeState.meterProvider = null;
  runtimeState.metricReader = null;
  runtimeState.spanProcessor = null;
  getPendingLogExports().clear();
}

function getObservabilityTraceContextKey(): string {
  return QUEUE_TRACE_CONTEXT_KEY;
}

function injectCurrentTraceContext(): TraceCarrier {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function extractHttpTraceContext(headers: Headers): Context {
  const carrier: TraceCarrier = {};

  for (const [key, value] of headers.entries()) {
    carrier[key] = value;
  }

  return propagation.extract(context.active(), carrier);
}

export function attachTraceContext<T extends Record<string, unknown>>(payload: T): T {
  const carrier = injectCurrentTraceContext();
  if (Object.keys(carrier).length === 0) {
    return payload;
  }

  return {
    ...payload,
    [QUEUE_TRACE_CONTEXT_KEY]: carrier,
  };
}

export function extractTraceContextFromPayload(payload: unknown): TraceCarrier | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const carrier = (payload as Record<string, unknown>)[QUEUE_TRACE_CONTEXT_KEY];
  if (!carrier || typeof carrier !== "object") {
    return undefined;
  }

  const normalizedEntries = Object.entries(carrier).filter((entry): entry is [string, string] => {
    return typeof entry[0] === "string" && typeof entry[1] === "string";
  });

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

export async function withExtractedTraceContext<T>(
  carrier: TraceCarrier | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!carrier || Object.keys(carrier).length === 0) {
    return fn();
  }

  const extracted = propagation.extract(context.active(), carrier);
  return context.with(extracted, fn);
}

function buildTraceIdContext(traceId: string | undefined): Context | undefined {
  if (!traceId || !/^[0-9a-f]{32}$/.test(traceId)) {
    return undefined;
  }

  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId: globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

export async function withTraceIdContext<T>(
  traceId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const traceContext = buildTraceIdContext(traceId);
  if (!traceContext) {
    return fn();
  }

  return context.with(traceContext, fn);
}

export async function startActiveServerSpan<T>(
  name: string,
  options: {
    attributes?: MetricAttributes;
    kind?: SpanKind;
    parentContext?: Context;
  } = {},
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = runtimeState.tracer ?? trace.getTracer(INSTRUMENTATION_SCOPE);
  const parentContext = options.parentContext ?? context.active();

  return context.with(parentContext, () =>
    tracer.startActiveSpan(
      name,
      {
        kind: options.kind,
        attributes: trimUndefinedAttributes(options.attributes),
      },
      async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    ),
  );
}

export function recordCounter(
  name: string,
  value = 1,
  attributes?: MetricAttributes,
  description?: string,
): void {
  if (isObservabilityDisabled()) {
    return;
  }

  const counter = getOrCreateCounter(name, description);
  counter.add(value, trimUndefinedAttributes(withRuntimeMetricAttributes(attributes)));
}

export function recordHistogram(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  description?: string,
): void {
  if (isObservabilityDisabled()) {
    return;
  }

  const histogram = getOrCreateHistogram(name, description);
  histogram.record(value, trimUndefinedAttributes(withRuntimeMetricAttributes(attributes)));
}

export function registerObservableGauge(
  name: string,
  callback: (observe: (value: number, attributes?: MetricAttributes) => void) => void,
  description?: string,
): void {
  if (isObservabilityDisabled()) {
    return;
  }

  if (runtimeState.instruments.observableGauges.has(name)) {
    return;
  }

  metrics
    .getMeter(INSTRUMENTATION_SCOPE)
    .createObservableGauge(name, description ? { description } : undefined)
    .addCallback((observableResult: ObservableResult) => {
      callback((value, attributes) => {
        observableResult.observe(
          value,
          trimUndefinedAttributes(withRuntimeMetricAttributes(attributes)),
        );
      });
    });

  runtimeState.instruments.observableGauges.add(name);
}

export function createTraceId(): string {
  return getActiveSpanIds().traceId ?? globalThis.crypto.randomUUID().replaceAll("-", "");
}

function enrichActiveSpan(attributes: Record<string, unknown>): void {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return;
  }

  const spanAttributes: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Array.isArray(value)
    ) {
      spanAttributes[key] = value as Attributes[string];
    }
  }

  if (Object.keys(spanAttributes).length > 0) {
    activeSpan.setAttributes(spanAttributes);
  }
}

function runWithTelemetrySpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  traceId: string | undefined,
  fn: () => T,
): T {
  const tracer = runtimeState.tracer ?? trace.getTracer(INSTRUMENTATION_SCOPE);
  const parentContext = buildTraceIdContext(traceId) ?? context.active();

  return tracer.startActiveSpan(name, {}, parentContext, (span) => {
    try {
      enrichActiveSpan(attributes);
      const result = fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

function buildCommonTelemetryEnvelope(input: {
  eventId: string;
  eventKind: "canonical_service_event" | "client_observation";
  eventName: string;
  timestamp?: Date;
  context?: ObservabilityContext;
}): Record<string, CanonicalValue> {
  return {
    "event.kind": input.eventKind,
    "cmdclaw.event.id": input.eventId,
    "cmdclaw.event.name": input.eventName,
    "cmdclaw.telemetry.schema_version": TELEMETRY_SCHEMA_VERSION,
    "service.name": input.context?.service ?? runtimeState.serviceName,
    "service.namespace": SERVICE_NAMESPACE,
    "service.version": process.env.npm_package_version ?? "0.1.0",
    "deployment.environment": runtimeState.env,
    "cmdclaw.deployment.id": process.env.RENDER_SERVICE_ID ?? process.env.CMDCLAW_DEPLOYMENT_ID,
    "cmdclaw.deployment.commit_sha":
      process.env.RENDER_GIT_COMMIT ?? process.env.CMDCLAW_COMMIT_SHA,
    "cmdclaw.instance.id": process.env.CMDCLAW_INSTANCE_ID,
    "cmdclaw.worktree.slot": process.env.CMDCLAW_WORKTREE_SLOT,
    timestamp: input.timestamp ?? new Date(),
  };
}

export function emitCanonicalServiceEvent(input: CanonicalServiceEventInput): void {
  const payload = normalizeTelemetryAttributes({
    ...buildCommonTelemetryEnvelope({
      eventId: input.eventId,
      eventKind: "canonical_service_event",
      eventName: input.eventName,
      timestamp: input.timestamp,
      context: input.context,
    }),
    "cmdclaw.operation.name": input.operationName,
    "cmdclaw.operation.outcome": input.outcome,
    ...input.attributes,
  });

  runWithTelemetrySpan(input.eventName, payload, input.context?.traceId, () => {
    const activeIds = getActiveSpanIds();
    logServerEvent(
      input.level ?? (input.outcome === "success" ? "info" : "error"),
      input.eventName,
      payload,
      {
        ...input.context,
        traceId: input.context?.traceId ?? activeIds.traceId,
      },
    );
  });
}

export function emitClientObservation(input: ClientObservationInput): void {
  const payload = normalizeTelemetryAttributes({
    ...buildCommonTelemetryEnvelope({
      eventId: input.eventId,
      eventKind: "client_observation",
      eventName: input.eventType,
      timestamp: input.timestamp,
      context: input.context,
    }),
    "cmdclaw.client_observation.type": input.eventType,
    ...input.attributes,
  });

  runWithTelemetrySpan("cmdclaw.client_observation", payload, input.context?.traceId, () => {
    const activeIds = getActiveSpanIds();
    logServerEvent("info", "CLIENT_OBSERVATION", payload, {
      ...input.context,
      traceId: input.context?.traceId ?? activeIds.traceId,
    });
  });
}

export function logServerEvent(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
  contextValue: ObservabilityContext = {},
): void {
  const activeIds = getActiveSpanIds();
  const traceId = contextValue.traceId ?? activeIds.traceId;
  const spanId = activeIds.spanId;

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    service: contextValue.service ?? runtimeState.serviceName,
    env: runtimeState.env,
    ...contextValue,
    ...details,
    ...(traceId ? { traceId, trace_id: traceId } : {}),
    ...(spanId ? { spanId, span_id: spanId } : {}),
  };

  forwardLogPayload(payload);

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
