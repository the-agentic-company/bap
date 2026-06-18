// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

// View-layer mock factories for the ChatArea test suites.
//
// Importing this module for its side effects registers `vi.mock(...)` for every
// rendered child component and UI primitive ChatArea mounts: the bottom action
// bar (the test's primary interaction surface), the activity feed, message list,
// approval/auth cards, the agentic-app panel, and the design-system primitives
// (button, dropdown, input, popover, switch), plus `motion/react`.
//
// This is the view half of the shared mock surface; the data half lives in
// `./chat-area.test-mocks-data`. Both halves read the same hoisted state from
// `./chat-area.test-mocks-state`.

import React from "react";
import { vi } from "vitest";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
          <div {...props}>{children}</div>
        ),
    },
  ),
}));

vi.mock("./activity-feed", () => ({
  ActivityFeed: () => <div>Activity Feed</div>,
}));

vi.mock("./auth-request-card", () => ({
  AuthRequestCard: () => <div>Auth Request</div>,
}));

vi.mock("./bottom-action-bar", () => ({
  BottomActionBar: ({
    onSubmit,
    onStop,
    isStreaming,
    prefillRequest,
    segments,
    segmentApproveHandlers,
  }: {
    onSubmit: (content: string) => void | Promise<unknown>;
    onStop?: () => void | Promise<unknown>;
    isStreaming?: boolean;
    prefillRequest?: { text: string } | null;
    segments?: Array<{
      id: string;
      approval?: {
        status: string;
        toolInput?: {
          questions?: Array<{
            header?: string;
            question?: string;
            options?: Array<{ label?: string }>;
          }>;
        };
      };
    }>;
    segmentApproveHandlers?: Map<string, (questionAnswers?: string[][]) => void>;
  }) => {
    const [status, setStatus] = React.useState("idle");
    const pendingApprovalSegment = segments?.find(
      (segment) => segment.approval?.status === "pending",
    );
    const firstQuestion = pendingApprovalSegment?.approval?.toolInput?.questions?.[0];
    const handleClick = React.useCallback(() => {
      setStatus("pending");
      void Promise.resolve(onSubmit(prefillRequest?.text ?? "hello")).then(() =>
        setStatus("resolved"),
      );
    }, [onSubmit, prefillRequest?.text]);
    const handleApprovePending = React.useCallback(() => {
      if (!pendingApprovalSegment) {
        return;
      }
      segmentApproveHandlers?.get(pendingApprovalSegment.id)?.([["Yes"]]);
    }, [pendingApprovalSegment, segmentApproveHandlers]);
    return (
      <div>
        {firstQuestion ? (
          <div>
            <div>{firstQuestion.header}</div>
            <div>{firstQuestion.question}</div>
            <button type="button" onClick={handleApprovePending}>
              {firstQuestion.options?.[0]?.label ?? "Approve"}
            </button>
          </div>
        ) : null}
        <button type="button" onClick={handleClick}>
          Send
        </button>
        {isStreaming ? (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        ) : null}
        <div data-testid="submit-status">{status}</div>
      </div>
    );
  },
}));

vi.mock("./message-list", () => ({
  MessageList: ({ messages }: { messages: Array<{ id: string; content: string }> }) => (
    <div>
      {messages.map((message) => (
        <div key={message.id}>{message.content}</div>
      ))}
    </div>
  ),
}));

vi.mock("./agentic-app-panel", () => ({
  AgenticAppPanel: ({ outputFile }: { outputFile: { fileId: string } }) => (
    <div data-testid="agentic-app-panel" data-file-id={outputFile.fileId}>
      Agentic-App Panel
    </div>
  ),
}));

vi.mock("./model-selector", () => ({
  ModelSelector: () => <div>Model Selector</div>,
}));

vi.mock("./tool-approval-card", () => ({
  ToolApprovalCard: ({
    status,
    questionAnswers,
  }: {
    status: "pending" | "approved" | "denied";
    questionAnswers?: string[][];
  }) => (
    <div>
      <div>{`Tool Approval ${status}`}</div>
      {questionAnswers?.flat().map((answer) => (
        <div key={answer}>{`Answer ${answer}`}</div>
      ))}
    </div>
  ),
}));

vi.mock("./voice-indicator", () => ({
  VoiceIndicator: () => <div>Voice Indicator</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
  }) => <div onClick={onClick}>{children}</div>,
  DropdownMenuSeparator: () => <div />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => {
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        onCheckedChange?.(event.target.checked);
      },
      [onCheckedChange],
    );
    return <input type="checkbox" checked={checked} onChange={handleChange} />;
  },
}));
