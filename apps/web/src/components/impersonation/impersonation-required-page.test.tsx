// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImpersonationRequiredPage, type ImpersonationTarget } from "./impersonation-required-page";

void jestDomVitest;

const { getSessionMock, stopImpersonatingMock, impersonateUserMock, assignMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    stopImpersonatingMock: vi.fn(),
    impersonateUserMock: vi.fn(),
    assignMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: getSessionMock,
    admin: {
      stopImpersonating: stopImpersonatingMock,
      impersonateUser: impersonateUserMock,
    },
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = "button",
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const target: ImpersonationTarget = {
  resourceType: "coworker_run",
  resourceId: "run-1",
  resourceLabel: "@inbox-triage",
  owner: {
    id: "user-2",
    name: "Other User",
    email: "other@example.com",
    image: null,
  },
};

describe("ImpersonationRequiredPage", () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          impersonatedBy: "admin-user",
        },
      },
    });
    stopImpersonatingMock.mockResolvedValue({});
    impersonateUserMock.mockResolvedValue({});
    assignMock.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: assignMock,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stops an existing impersonation before switching to the target owner", async () => {
    render(<ImpersonationRequiredPage target={target} redirectPath="/agents/runs/run-1" />);

    fireEvent.click(screen.getByRole("button", { name: /impersonate and continue/i }));

    await waitFor(() => {
      expect(stopImpersonatingMock).toHaveBeenCalledTimes(1);
      expect(impersonateUserMock).toHaveBeenCalledWith({ userId: "user-2" });
      expect(assignMock).toHaveBeenCalledWith("/agents/runs/run-1");
    });
  });
});
