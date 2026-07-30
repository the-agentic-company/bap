// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const reportRootErrorObservationMock = vi.hoisted(() =>
  vi.fn<(error: unknown, eventId?: string) => void>(),
);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("gt-react", () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/client-observations", () => ({
  reportRootErrorObservation: reportRootErrorObservationMock,
}));

import { RootErrorBoundary } from "./root-error-boundary";

describe("RootErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reports the captured React error with one stable event id", async () => {
    const error = new DOMException("Failed to execute 'removeChild' on 'Node'", "NotFoundError");

    render(<RootErrorBoundary error={error} />);

    expect(screen.getByText(error.message)).toBeInTheDocument();
    await waitFor(() => {
      expect(reportRootErrorObservationMock).toHaveBeenCalledWith(error, expect.any(String));
    });
    const eventId = reportRootErrorObservationMock.mock.calls[0]?.[1];
    expect(eventId).toHaveLength(36);
    expect(new Set(reportRootErrorObservationMock.mock.calls.map((call) => call[1]))).toEqual(
      new Set([eventId]),
    );
  });

  it("rotates the event id when the boundary receives a new error", async () => {
    const firstError = new Error("first");
    const secondError = new Error("second");
    const view = render(<RootErrorBoundary error={firstError} />);
    await waitFor(() => expect(reportRootErrorObservationMock).toHaveBeenCalledTimes(1));
    const firstEventId = reportRootErrorObservationMock.mock.calls[0]?.[1];

    view.rerender(<RootErrorBoundary error={secondError} />);

    await waitFor(() => expect(reportRootErrorObservationMock).toHaveBeenCalledTimes(2));
    expect(reportRootErrorObservationMock.mock.calls[1]?.[1]).not.toBe(firstEventId);
  });
});
