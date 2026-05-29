import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLoggerRuntime, logger, normalizeLogFields, setLoggerSinkForTest } from "./logger";
import {
  createTraceId,
  emitCanonicalServiceEvent,
  emitClientObservation,
  normalizeTelemetryAttributes,
  resolveObservabilityVectorUrls,
  serializeErrorDiagnostic,
} from "./observability";

function captureLogs() {
  const records: Array<{ level: string; record: Record<string, unknown>; message: string }> = [];
  setLoggerSinkForTest((level, record, message) => {
    records.push({ level, record, message });
  });
  configureLoggerRuntime({ serviceName: "cmdclaw-test", env: "test" });
  return records;
}

afterEach(() => {
  setLoggerSinkForTest(null);
  vi.restoreAllMocks();
});

describe("resolveObservabilityVectorUrls", () => {
  it("uses the explicit Vector host and ports from the environment", () => {
    const urls = resolveObservabilityVectorUrls({
      CMDCLAW_VECTOR_HOST: "cmdclaw-vector-staging",
      CMDCLAW_VECTOR_LOG_PORT: "8686",
      CMDCLAW_VECTOR_OTLP_HTTP_PORT: "4318",
      CMDCLAW_VECTOR_TRACES_PORT: "5318",
    });

    expect(urls).toEqual({
      metricsUrl: "http://cmdclaw-vector-staging:4318/v1/metrics",
      tracesUrl: "http://cmdclaw-vector-staging:5318/v1/traces",
    });
  });

  it("prefers fully qualified endpoint URLs when provided", () => {
    const urls = resolveObservabilityVectorUrls({
      CMDCLAW_VECTOR_METRICS_URL: "http://vector.example/metric-ingest",
      CMDCLAW_VECTOR_TRACES_URL: "http://vector.example/trace-ingest",
      CMDCLAW_VECTOR_HOST: "ignored-host",
      CMDCLAW_VECTOR_LOG_PORT: "9999",
      CMDCLAW_VECTOR_OTLP_HTTP_PORT: "9998",
    });

    expect(urls).toEqual({
      metricsUrl: "http://vector.example/metric-ingest",
      tracesUrl: "http://vector.example/trace-ingest",
    });
  });

  it("falls back to localhost defaults only when no Vector env is set", () => {
    const urls = resolveObservabilityVectorUrls({});

    expect(urls).toEqual({
      metricsUrl: "http://127.0.0.1:4318/v1/metrics",
      tracesUrl: "http://127.0.0.1:5318/v1/traces",
    });
  });

  it("keeps traces on the dedicated raw OTLP port when only the shared OTLP port is set", () => {
    const urls = resolveObservabilityVectorUrls({
      CMDCLAW_VECTOR_HOST: "cmdclaw-vector-staging",
      CMDCLAW_VECTOR_OTLP_HTTP_PORT: "4318",
    });

    expect(urls).toEqual({
      metricsUrl: "http://cmdclaw-vector-staging:4318/v1/metrics",
      tracesUrl: "http://cmdclaw-vector-staging:5318/v1/traces",
    });
  });
});

describe("normalizeTelemetryAttributes", () => {
  it("normalizes emitted field names to dotted snake case", () => {
    expect(
      normalizeTelemetryAttributes({
        cmdclaw: {
          generationId: "gen-1",
          failurePhase: "runtime",
        },
        "http.route": "/api/rpc/generation/startGeneration",
        elapsedMs: 123,
      }),
    ).toEqual({
      cmdclaw: {
        generation_id: "gen-1",
        failure_phase: "runtime",
      },
      "http.route": "/api/rpc/generation/startGeneration",
      elapsed_ms: 123,
    });
  });

  it("drops forbidden content and credential fields", () => {
    expect(
      normalizeTelemetryAttributes({
        "cmdclaw.generation.id": "gen-1",
        prompt: "do secret work",
        authorization: "Bearer token",
        requestBody: { content: "raw body" },
        toolInput: { query: "raw tool payload" },
        safeSummary: {
          attachmentCount: 2,
          token: "secret",
        },
      }),
    ).toEqual({
      "cmdclaw.generation.id": "gen-1",
      safe_summary: {
        attachment_count: 2,
      },
    });
  });

  it("keeps safe phase timing fields whose names include prompt", () => {
    expect(
      normalizeTelemetryAttributes({
        "cmdclaw.phase.pre_prompt_setup_ms": 25,
        "cmdclaw.phase.prompt_to_first_token_ms": 50,
        prompt: "do secret work",
      }),
    ).toEqual({
      "cmdclaw.phase.pre_prompt_setup_ms": 25,
      "cmdclaw.phase.prompt_to_first_token_ms": 50,
    });
  });
});

describe("serializeErrorDiagnostic", () => {
  it("keeps standard Error fields that JSON.stringify would drop", () => {
    const cause = new Error("upstream refused connection");
    const error = Object.assign(new Error("render failed", { cause }), {
      code: "ERR_RENDER",
      status: 502,
    });

    expect(JSON.stringify(error)).toBe('{"code":"ERR_RENDER","status":502}');

    const diagnostic = serializeErrorDiagnostic(error);

    expect(diagnostic).toEqual(
      expect.objectContaining({
        type: "Error",
        message: "render failed: upstream refused connection",
        code: "ERR_RENDER",
        status: 502,
      }),
    );
    expect(diagnostic.stack).toEqual(expect.stringContaining("Error: render failed"));
  });
});

describe("logger", () => {
  it("serializes Error fields into Operational Logs instead of forwarding empty objects", () => {
    const records = captureLogs();

    logger.error(
      {
        event: "RENDER_FAILED",
        err: Object.assign(new Error("template exploded"), { code: "ERR_TEMPLATE" }),
      },
      "render failed",
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        level: "error",
        message: "render failed",
      }),
    );
    expect(records[0]?.record).toEqual(
      expect.objectContaining({
        "event.kind": "operational_log",
        event: "render.failed",
        err: expect.objectContaining({
          type: "Error",
          message: "template exploded",
          code: "ERR_TEMPLATE",
          stack: expect.stringContaining("Error: template exploded"),
        }),
      }),
    );
    expect(JSON.stringify(records[0]?.record.err)).not.toBe("{}");
  });

  it("serializes nested Error values and removes forbidden fields", () => {
    expect(
      normalizeLogFields({
        operation: "render",
        error: new TypeError("invalid block"),
        authorization: "Bearer secret",
        requestBody: { content: "raw body" },
        safeSummary: {
          attachmentCount: 2,
          token: "secret",
        },
      }),
    ).toEqual({
      operation: "render",
      error: expect.objectContaining({
        type: "TypeError",
        message: "invalid block",
      }),
      safe_summary: {
        attachment_count: 2,
      },
    });
  });

  it("adds explicit product pivots and keeps cmdclaw.event.name off Operational Logs", () => {
    const records = captureLogs();

    logger
      .child({
        generationId: "gen-1",
        conversationId: "conv-1",
      })
      .warn({
        event: "GENERATION_PREPARING_STUCK_DETECTED",
        userId: "user-1",
      });

    expect(records[0]?.record).toEqual(
      expect.objectContaining({
        "event.kind": "operational_log",
        event: "generation.preparing_stuck_detected",
        "service.name": "cmdclaw-test",
        "deployment.environment": "test",
        "cmdclaw.generation.id": "gen-1",
        "cmdclaw.conversation.id": "conv-1",
        "cmdclaw.user.id": "user-1",
        "cmdclaw.telemetry.schema_version": "2026-05-22",
      }),
    );
    expect(records[0]?.record).not.toHaveProperty("cmdclaw.event.name");
  });
});

describe("semantic log emission", () => {
  it("emits Canonical Service Events through the shared log sink", () => {
    const records = captureLogs();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    emitCanonicalServiceEvent({
      eventId: "event-1",
      eventName: "cmdclaw.generation.terminal",
      operationName: "generation.terminal",
      outcome: "success",
      context: {
        traceId: "a".repeat(32),
        generationId: "gen-1",
      },
      attributes: {
        "cmdclaw.generation.id": "gen-1",
      },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]?.record).toEqual(
      expect.objectContaining({
        "event.kind": "canonical_service_event",
        "cmdclaw.event.id": "event-1",
        "cmdclaw.event.name": "cmdclaw.generation.terminal",
        "cmdclaw.operation.name": "generation.terminal",
        "cmdclaw.operation.outcome": "success",
        "cmdclaw.generation.id": "gen-1",
        trace_id: "a".repeat(32),
      }),
    );
  });

  it("emits Client Observations through the shared log sink", () => {
    const records = captureLogs();

    emitClientObservation({
      eventId: "client-event-1",
      eventType: "generation.stream.error",
      context: {
        traceId: "b".repeat(32),
        generationId: "gen-2",
      },
      attributes: {
        "cmdclaw.client.visible_error_code": "stream_closed",
      },
    });

    expect(records[0]?.record).toEqual(
      expect.objectContaining({
        "event.kind": "client_observation",
        "cmdclaw.event.id": "client-event-1",
        "cmdclaw.event.name": "generation.stream.error",
        "cmdclaw.client_observation.type": "generation.stream.error",
        "cmdclaw.client.visible_error_code": "stream_closed",
        trace_id: "b".repeat(32),
      }),
    );
  });
});

describe("createTraceId", () => {
  it("returns an OpenTelemetry-compatible trace id", () => {
    expect(createTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
