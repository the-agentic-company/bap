// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CoworkerRunLayout from "./layout";

void jestDomVitest;

const { mockParams, mockRun, mockIsAdmin } = vi.hoisted(() => ({
  mockParams: { current: { id: "run-1" } },
  mockRun: {
    current: {
      conversationId: "conv-1",
      coworkerName: "Inbox Triage",
      coworkerUsername: "inbox-triage",
    } as {
      conversationId: string | null;
      coworkerName?: string | null;
      coworkerUsername?: string | null;
    } | null,
  },
  mockIsAdmin: { current: false },
}));

vi.mock("next/navigation", () => ({
  useParams: () => mockParams.current,
}));

vi.mock("@/orpc/hooks", () => ({
  useCoworkerRun: () => ({ data: mockRun.current }),
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => ({ isAdmin: mockIsAdmin.current }),
}));

vi.mock("@/components/chat/chat-copy-button", () => ({
  ChatCopyButton: ({
    conversationId,
    className,
  }: {
    conversationId?: string;
    className?: string;
  }) => (
    <button className={className} type="button">
      Copy {conversationId}
    </button>
  ),
}));

vi.mock("@/components/chat/chat-share-controls", () => ({
  ChatShareControls: ({ conversationId }: { conversationId?: string }) => (
    <button type="button">Share {conversationId}</button>
  ),
}));

vi.mock("@/components/conversation-usage-dialog", () => ({
  ConversationUsageDialog: () => null,
}));

describe("CoworkerRunLayout", () => {
  afterEach(() => {
    cleanup();
    mockParams.current = { id: "run-1" };
    mockRun.current = {
      conversationId: "conv-1",
      coworkerName: "Inbox Triage",
      coworkerUsername: "inbox-triage",
    };
    mockIsAdmin.current = false;
  });

  it("shows the coworker username in the header when available", () => {
    render(
      <CoworkerRunLayout>
        <div>Child</div>
      </CoworkerRunLayout>,
    );

    expect(screen.getByText("@inbox-triage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run actions" })).toBeInTheDocument();
    expect(screen.queryByText("ID: run-1")).not.toBeInTheDocument();
  });

  it("falls back to the coworker name when username is missing", () => {
    mockRun.current = {
      conversationId: "conv-1",
      coworkerName: "Inbox Triage",
      coworkerUsername: null,
    };

    render(
      <CoworkerRunLayout>
        <div>Child</div>
      </CoworkerRunLayout>,
    );

    expect(screen.getByText("Inbox Triage")).toBeInTheDocument();
  });

  it("falls back to the run id for admins when no coworker label is available", () => {
    mockRun.current = {
      conversationId: "conv-1",
      coworkerName: null,
      coworkerUsername: null,
    };
    mockIsAdmin.current = true;

    render(
      <CoworkerRunLayout>
        <div>Child</div>
      </CoworkerRunLayout>,
    );

    expect(screen.getByText("ID: run-1")).toBeInTheDocument();
  });
});
