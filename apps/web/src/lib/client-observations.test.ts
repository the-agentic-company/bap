// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportRootErrorObservation } from "./client-observations";

describe("reportRootErrorObservation", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: undefined,
    });
    window.history.replaceState({}, "", "/settings/workspace?invite=private");
    document.documentElement.lang = "fr";
    document.documentElement.classList.add("translated-ltr");
  });

  afterEach(() => {
    document.documentElement.classList.remove("translated-ltr");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports bounded, redacted root diagnostics without URL query parameters", () => {
    const error = {
      name: "NotFoundError",
      message: "removeChild failed token=super-secret",
      stack: "at https://heybap.com/settings/workspace?token=super-secret:1:1",
    };

    reportRootErrorObservation(error, "root-error-123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      observations: Array<Record<string, unknown>>;
    };
    expect(body.observations[0]).toEqual(
      expect.objectContaining({
        eventId: "root-error-123456",
        eventType: "ui.root_error",
        routePath: "/settings/workspace",
        errorName: "NotFoundError",
        errorMessage: "removeChild failed token=[REDACTED]",
        errorStack: "at https://heybap.com/settings/workspace",
        documentLanguage: "fr",
        browserTranslationActive: true,
      }),
    );
  });

  it("keeps diagnostic values within the intake schema limits", () => {
    reportRootErrorObservation(
      {
        name: "Error",
        message: "m".repeat(2_000),
        stack: "s".repeat(10_000),
      },
      "root-error-bounded",
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      observations: Array<{ errorMessage: string; errorStack: string }>;
    };
    expect(body.observations[0]?.errorMessage).toHaveLength(1_024);
    expect(body.observations[0]?.errorStack).toHaveLength(8_192);
  });

  it("redacts opaque route segments and JSON-style credential assignments", () => {
    window.history.replaceState({}, "", "/shared/Abc12345678901234567890");

    reportRootErrorObservation(
      {
        name: "Error",
        message: '{"token":"super-secret"}',
        stack: "at https://heybap.com/shared/Abc12345678901234567890?token=secret",
      },
      "root-error-secret-route",
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      observations: Array<Record<string, unknown>>;
    };
    expect(body.observations[0]).toEqual(
      expect.objectContaining({
        routePath: "/shared/[redacted-id]",
        errorMessage: '{"token":[REDACTED]}',
        errorStack: "at https://heybap.com/shared/[redacted-id]",
      }),
    );
  });
});
