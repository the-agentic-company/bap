// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "./page";

type MockFn = (...args: unknown[]) => unknown;

const {
  mockStartGeneration,
  mockRouterPush,
  mockRouterReplace,
  mockUseIsAdmin,
  mockUseInboxItems,
  mockCoworkerList,
  mockSubmitApprovalMutateAsync,
  mockSubmitAuthResultMutateAsync,
  mockCancelGenerationMutateAsync,
  mockEnqueueConversationMessageMutateAsync,
  mockTriggerCoworkerMutateAsync,
  mockGetAuthUrlMutateAsync,
  mockGetOrCreateBuilderConversationMutateAsync,
  mockEditApprovalAndResendMutateAsync,
  mockMarkAsReadMutateAsync,
  mockDismissCoworkerRun,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => {
  return {
    mockStartGeneration: vi.fn<MockFn>(),
    mockRouterPush: vi.fn<MockFn>(),
    mockRouterReplace: vi.fn<MockFn>(),
    mockUseIsAdmin: vi.fn<MockFn>(),
    mockUseInboxItems: vi.fn<MockFn>(),
    mockCoworkerList: vi.fn<MockFn>(),
    mockSubmitApprovalMutateAsync: vi.fn<MockFn>(),
    mockSubmitAuthResultMutateAsync: vi.fn<MockFn>(),
    mockCancelGenerationMutateAsync: vi.fn<MockFn>(),
    mockEnqueueConversationMessageMutateAsync: vi.fn<MockFn>(),
    mockTriggerCoworkerMutateAsync: vi.fn<MockFn>(),
    mockGetAuthUrlMutateAsync: vi.fn<MockFn>(),
    mockGetOrCreateBuilderConversationMutateAsync: vi.fn<MockFn>(),
    mockEditApprovalAndResendMutateAsync: vi.fn<MockFn>(),
    mockMarkAsReadMutateAsync: vi.fn<MockFn>(),
    mockDismissCoworkerRun: vi.fn<MockFn>(),
    toastErrorMock: vi.fn<MockFn>(),
    toastSuccessMock: vi.fn<MockFn>(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...props} alt={String(props.alt ?? "")} />,
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => mockUseIsAdmin(),
}));

vi.mock("@/orpc/client", () => ({
  client: {
    generation: {
      startGeneration: mockStartGeneration,
    },
    inbox: {
      dismissCoworkerRun: mockDismissCoworkerRun,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/orpc/hooks", () => ({
  useInboxItems: (input: unknown) => mockUseInboxItems(input),
  useInfiniteInboxItems: (input: unknown) => mockUseInboxItems(input),
  useCoworkerList: () => mockCoworkerList(),
  useSubmitApproval: () => ({ mutateAsync: mockSubmitApprovalMutateAsync }),
  useSubmitAuthResult: () => ({ mutateAsync: mockSubmitAuthResultMutateAsync }),
  useCancelGeneration: () => ({ mutateAsync: mockCancelGenerationMutateAsync }),
  useEnqueueConversationMessage: () => ({ mutateAsync: mockEnqueueConversationMessageMutateAsync }),
  useTriggerCoworker: () => ({ mutateAsync: mockTriggerCoworkerMutateAsync, isPending: false }),
  useGetAuthUrl: () => ({ mutateAsync: mockGetAuthUrlMutateAsync }),
  useGetOrCreateBuilderConversation: () => ({
    mutateAsync: mockGetOrCreateBuilderConversationMutateAsync,
  }),
  useInboxEditApprovalAndResend: () => ({ mutateAsync: mockEditApprovalAndResendMutateAsync }),
  useInboxMarkAsRead: () => ({ mutateAsync: mockMarkAsReadMutateAsync }),
}));

describe("InboxPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsAdmin.mockReturnValue({ isAdmin: true, isLoading: false });
    mockUseInboxItems.mockReturnValue({
      data: {
        items: [
          {
            kind: "coworker",
            id: "run-completed",
            runId: "run-completed",
            coworkerId: "cw-1",
            coworkerName: "Inbox Triage",
            builderAvailable: true,
            title: "Inbox Triage · Mar 30, 16:32",
            status: "completed",
            updatedAt: new Date("2026-03-30T16:40:00.000Z"),
            createdAt: new Date("2026-03-30T16:32:00.000Z"),
            generationId: "gen-completed",
            conversationId: "conv-completed",
            errorMessage: null,
          },
          {
            kind: "coworker",
            id: "run-1",
            runId: "run-1",
            coworkerId: "cw-1",
            coworkerName: "Inbox Triage",
            builderAvailable: true,
            title: "Inbox Triage · Mar 30, 14:32",
            status: "awaiting_approval",
            updatedAt: new Date("2026-03-30T14:40:00.000Z"),
            createdAt: new Date("2026-03-30T14:32:00.000Z"),
            generationId: "gen-1",
            conversationId: "conv-1",
            errorMessage: null,
            pendingApproval: {
              interruptId: "interrupt-approval-1",
              toolUseId: "tool-1",
              toolName: "Slack send",
              toolInput: { channel: "#sales", text: "hello" },
              integration: "slack",
              operation: "send",
              command: 'slack send --channel "#sales" --text "hello"',
            },
          },
          {
            kind: "coworker",
            id: "run-paused",
            runId: "run-paused",
            coworkerId: "cw-1",
            coworkerName: "Inbox Triage",
            builderAvailable: true,
            title: "Inbox Triage · Mar 30, 15:00",
            status: "paused",
            updatedAt: new Date("2026-03-30T15:35:00.000Z"),
            createdAt: new Date("2026-03-30T15:00:00.000Z"),
            generationId: "gen-paused",
            conversationId: "conv-paused",
            pauseReason: "run_deadline",
            errorMessage: null,
          },
        ],
        sourceOptions: [{ coworkerId: "cw-1", coworkerName: "Inbox Triage" }],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });
    mockCoworkerList.mockReturnValue({
      data: [
        {
          id: "cw-1",
          name: "Inbox Triage",
          username: "inbox-triage",
          description: "Keeps the queue moving.",
          status: "on",
          triggerType: "manual",
          recentRuns: [{ id: "run-1", status: "awaiting_approval", startedAt: new Date() }],
        },
      ],
      isLoading: false,
    });
    mockSubmitApprovalMutateAsync.mockResolvedValue({ success: true });
    mockSubmitAuthResultMutateAsync.mockResolvedValue({ success: true });
    mockCancelGenerationMutateAsync.mockResolvedValue({ success: true });
    mockEnqueueConversationMessageMutateAsync.mockResolvedValue({ queuedMessageId: "qm-1" });
    mockTriggerCoworkerMutateAsync.mockResolvedValue({ runId: "run-1" });
    mockGetAuthUrlMutateAsync.mockResolvedValue({ authUrl: "https://example.com/auth" });
    mockGetOrCreateBuilderConversationMutateAsync.mockResolvedValue({
      conversationId: "builder-1",
    });
    mockEditApprovalAndResendMutateAsync.mockResolvedValue({ success: true });
    mockMarkAsReadMutateAsync.mockResolvedValue({ success: true });
    mockDismissCoworkerRun.mockResolvedValue({ success: true });
    mockStartGeneration.mockResolvedValue({
      generationId: "gen-resumed",
      conversationId: "conv-paused",
    });
  });

  it("shows a beta access message to non-admin users", () => {
    mockUseIsAdmin.mockReturnValue({ isAdmin: false, isLoading: false });

    render(<InboxPage />);

    expect(screen.getByText("Inbox is currently in beta and limited to admin users.")).toBeTruthy();
    expect(mockUseInboxItems).not.toHaveBeenCalled();
  });

  it("renders coworker inbox rows and queries coworkers only", () => {
    render(<InboxPage />);

    expect(screen.getByText("Inbox Triage · Mar 30, 16:32")).toBeTruthy();
    expect(screen.getByText("Inbox Triage · Mar 30, 15:00")).toBeTruthy();
    expect(screen.getByText("Inbox Triage · Mar 30, 14:32")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chats" })).toBeNull();
    expect(screen.queryByPlaceholderText("Trigger a coworker manually...")).toBeNull();
    expect(mockUseInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "coworkers",
        statuses: [
          "needs_user_input",
          "running",
          "awaiting_approval",
          "awaiting_auth",
          "paused",
          "completed",
          "error",
          "cancelled",
        ],
      }),
    );
  });

  it("continues a paused coworker run and opens the run", async () => {
    render(<InboxPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Continue/i }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith({
        conversationId: "conv-paused",
        content: "continue",
        resumePausedGenerationId: "gen-paused",
      });
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/agents/runs/run-paused");
  });

  it("wires approve and edit-before-approval actions to real mutations", async () => {
    render(<InboxPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Approve/i }));
    await waitFor(() => {
      expect(mockSubmitApprovalMutateAsync).toHaveBeenCalledWith({
        interruptId: "interrupt-approval-1",
        decision: "approve",
        questionAnswers: undefined,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    fireEvent.change(screen.getByDisplayValue("#sales"), { target: { value: "#ops" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(mockEditApprovalAndResendMutateAsync).toHaveBeenCalledWith({
        kind: "coworker",
        generationId: "gen-1",
        toolUseId: "tool-1",
        updatedToolInput: {
          channel: "#ops",
          text: "hello",
        },
        conversationId: "conv-1",
        runId: "run-1",
      });
    });
  });

  it("wires mark-as-read to the inbox mutation", async () => {
    render(<InboxPage />);

    const markReadButtons = await screen.findAllByRole("button", { name: /Mark read/i });
    fireEvent.click(markReadButtons[1]!);

    await waitFor(() => {
      expect(mockMarkAsReadMutateAsync).toHaveBeenCalledWith({
        kind: "coworker",
        id: "run-1",
      });
    });
  });

  it("dismisses a pending coworker start without using the normal chat reply UI", async () => {
    mockUseInboxItems.mockReturnValue({
      data: {
        items: [
          {
            kind: "coworker",
            id: "run-pending",
            runId: "run-pending",
            coworkerId: "cw-1",
            coworkerName: "Email Drafter",
            builderAvailable: true,
            title: "Email Drafter · Mar 30, 14:32",
            status: "needs_user_input",
            updatedAt: new Date("2026-03-30T14:40:00.000Z"),
            createdAt: new Date("2026-03-30T14:32:00.000Z"),
            generationId: null,
            conversationId: "conv-pending",
            errorMessage: null,
          },
        ],
        sourceOptions: [{ coworkerId: "cw-1", coworkerName: "Email Drafter" }],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });

    render(<InboxPage />);

    expect(screen.getByText("Email Drafter · Mar 30, 14:32")).toBeTruthy();
    expect(screen.getAllByText("Needs your input").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: /Dismiss/i }));

    await waitFor(() => {
      expect(mockDismissCoworkerRun).toHaveBeenCalledWith({ id: "run-pending" });
    });
    expect(mockCancelGenerationMutateAsync).not.toHaveBeenCalled();
  });
});
