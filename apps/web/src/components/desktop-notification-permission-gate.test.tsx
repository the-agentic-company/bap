// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { useCurrentUserMock } = vi.hoisted(() => ({
  useCurrentUserMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/orpc/hooks/user", () => ({
  useCurrentUser: useCurrentUserMock,
}));

vi.mock("@/lib/browser-push", () => ({
  setupBrowserPushNotifications: vi.fn<VitestProcedure>(),
}));

import { DesktopNotificationPermissionGate } from "./desktop-notification-permission-gate";

describe("DesktopNotificationPermissionGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentUserMock.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not enable the current-user query when disabled", () => {
    render(<DesktopNotificationPermissionGate enabled={false} />);

    expect(useCurrentUserMock).toHaveBeenCalledWith({ enabled: false });
  });
});
