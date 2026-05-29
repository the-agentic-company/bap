import { describe, expect, it } from "vitest";
import {
  buildConsolePayload,
  createTraceId,
  normalizeTelemetryAttributes,
  resolveObservabilityVectorUrls,
  serializeErrorDiagnostic,
} from "./observability";

describe("resolveObservabilityVectorUrls", () => {
  it("uses the explicit Vector host and ports from the environment", () => {
    const urls = resolveObservabilityVectorUrls({
      CMDCLAW_VECTOR_HOST: "cmdclaw-vector-staging",
      CMDCLAW_VECTOR_LOG_PORT: "8686",
      CMDCLAW_VECTOR_OTLP_HTTP_PORT: "4318",
      CMDCLAW_VECTOR_TRACES_PORT: "5318",
    });

    expect(urls).toEqual({
      logUrl: "http://cmdclaw-vector-staging:8686/logs",
      metricsUrl: "http://cmdclaw-vector-staging:4318/v1/metrics",
      tracesUrl: "http://cmdclaw-vector-staging:5318/v1/traces",
    });
  });

  it("prefers fully qualified endpoint URLs when provided", () => {
    const urls = resolveObservabilityVectorUrls({
      CMDCLAW_VECTOR_LOG_URL: "http://vector.example/log-ingest",
      CMDCLAW_VECTOR_METRICS_URL: "http://vector.example/metric-ingest",
      CMDCLAW_VECTOR_TRACES_URL: "http://vector.example/trace-ingest",
      CMDCLAW_VECTOR_HOST: "ignored-host",
      CMDCLAW_VECTOR_LOG_PORT: "9999",
      CMDCLAW_VECTOR_OTLP_HTTP_PORT: "9998",
    });

    expect(urls).toEqual({
      logUrl: "http://vector.example/log-ingest",
      metricsUrl: "http://vector.example/metric-ingest",
      tracesUrl: "http://vector.example/trace-ingest",
    });
  });

  it("falls back to localhost defaults only when no Vector env is set", () => {
    const urls = resolveObservabilityVectorUrls({});

    expect(urls).toEqual({
      logUrl: "http://127.0.0.1:8686/logs",
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
      logUrl: "http://cmdclaw-vector-staging:8686/logs",
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

describe("buildConsolePayload", () => {
  it("serializes console Error arguments into message, args, and err fields", () => {
    const payload = buildConsolePayload("error", [
      "[render] failed to render",
      Object.assign(new Error("template exploded"), { code: "ERR_TEMPLATE" }),
    ]);

    expect(payload.message).toBe("[render] failed to render Error: template exploded");
    expect(payload.args).toEqual([
      "[render] failed to render",
      expect.objectContaining({
        type: "Error",
        message: "template exploded",
        code: "ERR_TEMPLATE",
      }),
    ]);
    expect(payload.err).toEqual(
      expect.objectContaining({
        type: "Error",
        message: "template exploded",
        code: "ERR_TEMPLATE",
      }),
    );
  });

  it("serializes nested Error values instead of forwarding empty objects", () => {
    const payload = buildConsolePayload("error", [
      {
        operation: "render",
        error: new TypeError("invalid block"),
      },
    ]);

    expect(payload.args).toEqual([
      {
        operation: "render",
        error: expect.objectContaining({
          type: "TypeError",
          message: "invalid block",
        }),
      },
    ]);
    expect(payload.message).toEqual(expect.stringContaining('"message":"invalid block"'));
  });
});

describe("createTraceId", () => {
  it("returns an OpenTelemetry-compatible trace id", () => {
    expect(createTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
