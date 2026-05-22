// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHeaderActionsProvider } from "@/app/chat/chat-header-actions-context";

void jestDomVitest;

const {
  mockStartGeneration,
  mockSubscribeToGeneration,
  mockAbort,
  mockPosthogCapture,
  mockInvalidateQueries,
  mockRefetchQueries,
  mockSetQueryData,
  mockUseHotkeys,
  mockEnqueueConversationMessageMutateAsync,
  mockUpdateConversationQueuedMessageMutateAsync,
  mockConversationQueuedMessagesState,
  mockAdminState,
  mockActiveGenerationState,
  mockCancelGenerationMutateAsync,
  mockSubmitApprovalMutateAsync,
  mockSubmitAuthResultMutateAsync,
} = vi.hoisted(() => ({
  mockStartGeneration: vi.fn(),
  mockSubscribeToGeneration: vi.fn(),
  mockAbort: vi.fn(),
  mockPosthogCapture: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockRefetchQueries: vi.fn(),
  mockSetQueryData: vi.fn(),
  mockUseHotkeys: vi.fn(),
  mockEnqueueConversationMessageMutateAsync: vi.fn(),
  mockUpdateConversationQueuedMessageMutateAsync: vi.fn(),
  mockConversationQueuedMessagesState: {
    data: undefined as
      | Array<{
          id: string;
          content: string;
          status: "queued" | "processing";
          fileAttachments?: Array<{ name: string; mimeType: string; dataUrl: string }>;
          selectedPlatformSkillSlugs?: string[];
          createdAt: string;
        }>
      | undefined,
  },
  mockSubmitApprovalMutateAsync: vi.fn(),
  mockSubmitAuthResultMutateAsync: vi.fn(),
  mockCancelGenerationMutateAsync: vi.fn(),
  mockAdminState: {
    isAdmin: false,
    isLoading: false,
  },
  mockActiveGenerationState: {
    data: null as {
      generationId: string | null;
      startedAt: string | null;
      errorMessage: string | null;
      status: string | null;
      pauseReason: string | null;
      debugRunDeadlineMs: number | null;
      contentParts?: unknown[] | null;
    } | null,
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
      refetchQueries: mockRefetchQueries,
      setQueryData: mockSetQueryData,
    }),
  };
});

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    capture: mockPosthogCapture,
  }),
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: mockUseHotkeys,
}));

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

vi.mock("@/hooks/use-voice-recording", () => ({
  blobToBase64: vi.fn(),
  useVoiceRecording: () => ({
    isRecording: false,
    error: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => mockAdminState,
}));

vi.mock("@/lib/chat-model-access", () => ({
  isModelAccessibleForNewChat: () => true,
}));

vi.mock("@/lib/generation-runtime", () => ({
  createGenerationRuntime: () => {
    const snapshot = {
      parts: [] as unknown[],
      segments: [] as Array<{
        id: string;
        items: Array<Record<string, unknown>>;
        isExpanded: boolean;
        approval?: {
          interruptId?: string;
          toolUseId: string;
          toolName: string;
          toolInput: unknown;
          integration: string;
          operation: string;
          command?: string;
          status: "pending" | "approved" | "denied";
        };
        auth?: {
          interruptId?: string;
          integrations: string[];
          connectedIntegrations: string[];
          reason?: string;
          status: "pending" | "connecting" | "completed" | "cancelled";
        };
      }>,
      integrationsUsed: [] as string[],
      sandboxFiles: [] as unknown[],
      traceStatus: "complete" as "complete" | "streaming" | "waiting_approval" | "waiting_auth",
    };

    const ensureSegment = () => {
      if (snapshot.segments.length === 0) {
        snapshot.segments.push({
          id: "segment-1",
          items: [],
          isExpanded: false,
        });
      }
      return snapshot.segments[0]!;
    };

    return {
      get snapshot() {
        return snapshot;
      },
      handleText: vi.fn(),
      handleSystem: vi.fn(),
      handleThinking: vi.fn(),
      handleToolUse: vi.fn(
        (data: { toolUseId?: string; toolName: string; integration?: string }) => {
          const segment = ensureSegment();
          segment.items.push({
            id: data.toolUseId ?? `tool-${segment.items.length + 1}`,
            timestamp: Date.now(),
            type: "tool_call",
            content: data.toolName,
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            integration: data.integration,
            status: "running",
          });
        },
      ),
      handleToolResult: vi.fn(),
      handlePendingApproval: vi.fn(
        (data: {
          interruptId: string;
          toolUseId: string;
          toolName: string;
          toolInput: unknown;
          integration: string;
          operation: string;
          command?: string;
        }) => {
          const segment = ensureSegment();
          segment.approval = {
            interruptId: data.interruptId,
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            toolInput: data.toolInput,
            integration: data.integration,
            operation: data.operation,
            command: data.command,
            status: "pending",
          };
          snapshot.traceStatus = "waiting_approval";
        },
      ),
      handleApprovalResult: vi.fn(),
      handleApproval: vi.fn(),
      handleAuthNeeded: vi.fn(
        (data: { interruptId: string; integrations: string[]; reason?: string }) => {
          const segment = ensureSegment();
          segment.auth = {
            interruptId: data.interruptId,
            integrations: data.integrations,
            connectedIntegrations: [],
            reason: data.reason,
            status: "pending",
          };
          snapshot.traceStatus = "waiting_auth";
        },
      ),
      handleAuthProgress: vi.fn(),
      handleAuthResult: vi.fn(),
      handleSandboxFile: vi.fn(),
      handleDone: vi.fn(),
      handleCancelled: vi.fn(),
      handleError: vi.fn(),
      setStatus: vi.fn(),
      setApprovalStatus: vi.fn((toolUseId: string, status: "approved" | "denied") => {
        const segment = snapshot.segments.find((value) => value.approval?.toolUseId === toolUseId);
        if (segment?.approval) {
          segment.approval = {
            ...segment.approval,
            status,
          };
        }
        snapshot.traceStatus = "streaming";
      }),
      setAuthConnecting: vi.fn(),
      setAuthPending: vi.fn(),
      setAuthCancelled: vi.fn(),
      resolveAuthSuccess: vi.fn((integration: string) => {
        const segment = snapshot.segments.find(
          (value) =>
            value.auth &&
            (value.auth.status === "pending" || value.auth.status === "connecting") &&
            value.auth.integrations.includes(integration),
        );
        if (!segment?.auth) {
          return;
        }

        if (!segment.auth.connectedIntegrations.includes(integration)) {
          segment.auth.connectedIntegrations.push(integration);
        }

        const remaining = segment.auth.integrations.filter(
          (candidate) => !segment.auth?.connectedIntegrations.includes(candidate),
        );
        segment.auth.status = remaining.length === 0 ? "completed" : "connecting";
        snapshot.traceStatus = "streaming";
      }),
      buildAssistantMessage: () => ({
        content: "",
        parts: [],
        integrationsUsed: [],
        sandboxFiles: [],
      }),
      getActivityStats: () => ({
        totalToolCalls: 0,
        completedToolCalls: 0,
        totalToolDurationMs: 0,
        maxToolDurationMs: 0,
        perToolUseIdMs: {},
      }),
    };
  },
}));

vi.mock("@/orpc/client", () => ({
  client: {
    conversation: {
      get: vi.fn(),
    },
  },
}));

vi.mock("@/orpc/hooks", () => ({
  useConversation: () => ({ data: null, isLoading: false }),
  useGeneration: () => ({
    startGeneration: mockStartGeneration,
    subscribeToGeneration: mockSubscribeToGeneration,
    abort: mockAbort,
  }),
  useSubmitApproval: () => ({ mutateAsync: mockSubmitApprovalMutateAsync, isPending: false }),
  useSubmitAuthResult: () => ({ mutateAsync: mockSubmitAuthResultMutateAsync, isPending: false }),
  useGetAuthUrl: () => ({ mutateAsync: vi.fn() }),
  useActiveGeneration: () => mockActiveGenerationState,
  useCancelGeneration: () => ({ mutateAsync: mockCancelGenerationMutateAsync }),
  useDetectUserMessageLanguage: () => ({ mutateAsync: vi.fn() }),
  useConversationQueuedMessages: () => ({ data: mockConversationQueuedMessagesState.data }),
  useEnqueueConversationMessage: () => ({ mutateAsync: mockEnqueueConversationMessageMutateAsync }),
  useRemoveConversationQueuedMessage: () => ({ mutateAsync: vi.fn() }),
  useUpdateConversationQueuedMessage: () => ({
    mutateAsync: mockUpdateConversationQueuedMessageMutateAsync,
  }),
  usePlatformSkillList: () => ({ data: [], isLoading: false }),
  useSkillList: () => ({ data: [], isLoading: false }),
  useUpdateAutoApprove: () => ({ mutateAsync: vi.fn() }),
  useProviderAuthStatus: () => ({ data: { connected: {}, shared: {} } }),
  useOpencodeFreeModels: () => ({ data: { models: [] } }),
  useTranscribe: () => ({ mutateAsync: vi.fn() }),
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

vi.mock("./chat-message-sync", () => ({
  mergePersistedConversationMessages: ({
    currentMessages,
    persistedMessages,
  }: {
    currentMessages: unknown[];
    persistedMessages: unknown[];
  }) => (persistedMessages.length > 0 ? persistedMessages : currentMessages),
}));

function renderInChatHeader(children: React.ReactNode) {
  function HeaderShell({ innerChildren }: { innerChildren: React.ReactNode }) {
    const [headerActions, setHeaderActions] = React.useState<React.ReactNode>(null);
    const contextValue = React.useMemo(() => ({ setHeaderActions }), []);

    return (
      <ChatHeaderActionsProvider value={contextValue}>
        <div>{headerActions}</div>
        {innerChildren}
      </ChatHeaderActionsProvider>
    );
  }

  return render(<HeaderShell innerChildren={children} />);
}

vi.mock("./chat-model-store", () => ({
  useChatModelStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedModel: "anthropic/claude-sonnet-4-6",
      selectedAuthSource: null,
      setSelection: vi.fn(),
    }),
}));

vi.mock("./chat-skill-store", () => ({
  useChatSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedSkillSlugsByScope: {},
      toggleSelectedSkillSlug: vi.fn(),
      clearSelectedSkillSlugs: vi.fn(),
    }),
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

vi.mock("./model-selector", () => ({
  ModelSelector: () => <div>Model Selector</div>,
}));

vi.mock("./question-approval-utils", () => ({
  collectQuestionApprovalToolUseIds: () => new Set<string>(),
  isQuestionApprovalRequest: () => false,
}));

vi.mock("./tool-approval-card", () => ({
  ToolApprovalCard: ({ status }: { status: "pending" | "approved" | "denied" }) => (
    <div>{`Tool Approval ${status}`}</div>
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

import { ChatArea } from "./chat-area";

describe("ChatArea generation errors", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockStartGeneration.mockReset();
    mockAbort.mockReset();
    mockInvalidateQueries.mockReset();
    mockSetQueryData.mockReset();
    mockPosthogCapture.mockReset();
    mockUseHotkeys.mockReset();
    mockCancelGenerationMutateAsync.mockReset();
    mockEnqueueConversationMessageMutateAsync.mockReset();
    mockUpdateConversationQueuedMessageMutateAsync.mockReset();
    mockConversationQueuedMessagesState.data = undefined;
    mockAdminState.isAdmin = false;
    mockAdminState.isLoading = false;
    mockActiveGenerationState.data = null;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("shows an inline error and exits Preparing agent when startGeneration fails before onStarted", async () => {
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      await Promise.resolve();
      callbacks.onError?.({
        code: "model_access_denied",
        message:
          "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
        phase: "start_rpc",
        transportCode: "BAD_REQUEST",
      });
      return null;
    });

    render(<ChatArea />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Preparing agent...")).not.toBeInTheDocument();
  });

  it("cancels the durable active generation when stopping before a local stream id is attached", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mockActiveGenerationState.data = {
      generationId: "gen-active",
      startedAt: new Date("2026-05-22T10:00:00.000Z").toISOString(),
      errorMessage: null,
      status: "generating",
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
    };

    render(<ChatArea conversationId="conv-1" />);

    await waitFor(() => {
      expect(mockSubscribeToGeneration).toHaveBeenCalledWith("gen-active", expect.any(Object));
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(mockCancelGenerationMutateAsync).toHaveBeenCalledWith("gen-active");
    });
    expect(mockAbort).toHaveBeenCalled();
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["generation", "active", "conv-1"],
      expect.objectContaining({
        generationId: null,
        status: null,
      }),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("endReason=user_stopped"),
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining("endReason=user_stopped"));
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining("generationId=gen-active"));
    expect(mockPosthogCapture).toHaveBeenCalledWith(
      "agent_init_missing",
      expect.objectContaining({
        endReason: "user_stopped",
        generationId: "gen-active",
      }),
    );
  });

  it("resolves submit immediately without waiting for the full stream to finish", async () => {
    mockStartGeneration.mockImplementation(() => new Promise(() => {}));

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByTestId("submit-status")).toHaveTextContent("resolved");
    });
    expect(mockStartGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello", conversationId: "conv-1" }),
      expect.any(Object),
    );
  });

  it("syncs coworker queries when a coworker edit tool completes", async () => {
    const onCoworkerSync = vi.fn();

    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-1", "conv-1");
      mockInvalidateQueries.mockClear();
      callbacks.onToolUse?.({
        toolName: "Bash",
        toolInput: {
          command: "coworker edit cw-1 --changes-file /tmp/coworker.json --json",
        },
        toolUseId: "tool-1",
        integration: "coworker",
        operation: "edit",
      });
      callbacks.onToolResult?.(
        "Bash",
        {
          kind: "coworker_edit_apply",
          status: "applied",
          coworkerId: "cw-1",
        },
        "tool-1",
      );
      return null;
    });

    render(
      <ChatArea conversationId="conv-1" forceCoworkerQuerySync onCoworkerSync={onCoworkerSync} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenNthCalledWith(1, {
        queryKey: ["coworker"],
      });
      expect(mockInvalidateQueries).toHaveBeenNthCalledWith(2, {
        queryKey: ["coworker", "get", "cw-1"],
      });
    });
    expect(onCoworkerSync).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      prompt: undefined,
      updatedAt: undefined,
    });
  });

  it("queues additional messages without replacing the existing queue entry", async () => {
    mockStartGeneration.mockImplementation(() => new Promise(() => {}));
    mockEnqueueConversationMessageMutateAsync.mockResolvedValue({ queuedMessageId: "queue-2" });

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ content: "hello", conversationId: "conv-1" }),
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockEnqueueConversationMessageMutateAsync).toHaveBeenCalledWith({
        conversationId: "conv-1",
        content: "hello",
        selectedPlatformSkillSlugs: [],
        fileAttachments: undefined,
        replaceExisting: false,
      });
    });
  });

  it("renders all queued messages instead of only the first one", () => {
    mockConversationQueuedMessagesState.data = [
      {
        id: "queue-1",
        content: "First queued follow-up",
        status: "queued",
        createdAt: "2026-04-02T03:55:02.000Z",
      },
      {
        id: "queue-2",
        content: "Second queued follow-up",
        status: "queued",
        createdAt: "2026-04-02T03:56:02.000Z",
      },
    ];

    render(<ChatArea conversationId="conv-1" />);

    expect(screen.getByText("2 queued messages")).toBeInTheDocument();
    expect(screen.getByText("1. First queued follow-up")).toBeInTheDocument();
    expect(screen.getByText("2. Second queued follow-up")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Steer" })).toHaveLength(1);
  });

  it("edits a queued message in place instead of enqueueing a new one", async () => {
    mockConversationQueuedMessagesState.data = [
      {
        id: "queue-1",
        content: "Queued follow-up",
        status: "queued",
        selectedPlatformSkillSlugs: ["slack"],
        createdAt: "2026-04-02T03:55:02.000Z",
      },
    ];
    mockUpdateConversationQueuedMessageMutateAsync.mockResolvedValue({ success: true });

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit queued message 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockUpdateConversationQueuedMessageMutateAsync).toHaveBeenCalledWith({
        queuedMessageId: "queue-1",
        conversationId: "conv-1",
        content: "Queued follow-up",
        selectedPlatformSkillSlugs: ["slack"],
        fileAttachments: undefined,
      });
    });
    expect(mockEnqueueConversationMessageMutateAsync).not.toHaveBeenCalled();
    expect(mockStartGeneration).not.toHaveBeenCalled();
  });

  it("keeps the queued-send hotkey out of form fields", () => {
    render(<ChatArea conversationId="conv-1" />);

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      "mod+enter",
      expect.any(Function),
      expect.objectContaining({ enableOnFormTags: false }),
      expect.any(Array),
    );
  });

  it("does not render debug controls for non-admin users", () => {
    render(<ChatArea conversationId="conv-1" />);

    expect(screen.queryByRole("button", { name: /debug/i })).not.toBeInTheDocument();
  });

  it("arms the approval recovery preset and forwards the approval park override", async () => {
    mockAdminState.isAdmin = true;
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "7" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content: "send a message on slack #experiment-cmdclaw-testing saying hi",
          debugApprovalHotWaitMs: 7_000,
        }),
        expect.any(Object),
      );
    });
  });

  it("arms the auth recovery preset and forwards the auth park override", async () => {
    mockAdminState.isAdmin = true;
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "9" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content:
            "Use the Notion integration to list my first 5 Notion databases by name. Do not use any other source.",
          debugApprovalHotWaitMs: 9_000,
        }),
        expect.any(Object),
      );
    });
  });

  it("arms the question recovery preset and forwards the question park override", async () => {
    mockAdminState.isAdmin = true;
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.change(screen.getAllByRole("spinbutton")[2], { target: { value: "11" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content:
            "Use the question tool exactly once with header 'Pick', question 'Choose one', and options 'Alpha' and 'Beta'. After I answer, respond exactly as SELECTED=<answer>.",
          debugApprovalHotWaitMs: 11_000,
        }),
        expect.any(Object),
      );
    });
  });

  it("shows the runtime resume action for paused run-deadline generations", async () => {
    mockAdminState.isAdmin = true;
    mockActiveGenerationState.data = {
      generationId: "gen-paused",
      startedAt: "2026-04-10T10:00:00.000Z",
      errorMessage: null,
      status: "paused",
      pauseReason: "run_deadline",
      debugRunDeadlineMs: 30_000,
      contentParts: null,
    };
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.click(screen.getByRole("button", { name: /resume paused runtime/i }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content: "continue",
          resumePausedGenerationId: "gen-paused",
        }),
        expect.any(Object),
      );
    });
  });

  it("shows a continue question card when a run parks on the runtime deadline", async () => {
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-deadline", "conv-1");
      callbacks.onToolUse?.({
        toolName: "Bash",
        toolInput: { command: "google-gmail list -l 30" },
        toolUseId: "tool-1",
        integration: "google_gmail",
        operation: "list",
      });
      callbacks.onStatusChange?.("run_deadline_parked", {
        sandboxId: "sandbox-old",
        releasedSandboxId: "sandbox-old",
      });
      return null;
    });
    mockStartGeneration.mockResolvedValueOnce(null);

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Runtime limit reached")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/This run hit the 15m .* max runtime and stopped\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stopped after max runtime of 15m .*./i)).toBeInTheDocument();
    expect(screen.getAllByText("Activity Feed").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          conversationId: "conv-1",
          content: "continue",
          resumePausedGenerationId: "gen-deadline",
        }),
        expect.any(Object),
      );
    });
    expect(mockStartGeneration.mock.calls[1]?.[0]).not.toHaveProperty("debugRunDeadlineMs");
    expect(screen.getByText(/Resumed below\./i)).toBeInTheDocument();
    expect(screen.getByText("continue")).toBeInTheDocument();

    const originalMessage = screen.getByText("hello");
    const historicalBlock = screen.getByText(
      /Stopped after max runtime of 15m .* Resumed below\./i,
    );
    const continueMessage = screen.getByText("continue");

    expect(
      originalMessage.compareDocumentPosition(historicalBlock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      historicalBlock.compareDocumentPosition(continueMessage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("rehydrates paused runtime activity from persisted active-generation content parts", async () => {
    mockActiveGenerationState.data = {
      generationId: "gen-paused",
      startedAt: "2026-04-10T10:00:00.000Z",
      errorMessage: null,
      status: "paused",
      pauseReason: "run_deadline",
      debugRunDeadlineMs: 30_000,
      contentParts: [
        {
          type: "thinking",
          id: "thinking-1",
          content: "Reviewing recent emails",
        },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "google-gmail list -l 30" },
          integration: "google_gmail",
          operation: "list",
        },
      ],
    };

    render(<ChatArea conversationId="conv-1" />);

    expect(screen.getByText("Runtime limit reached")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This run hit the 30.0s max runtime and stopped. Do you want to continue from where it left off?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stopped after max runtime of 30\.0s/i)).toBeInTheDocument();
    expect(screen.getAllByText("Activity Feed").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("removes a parked approval card immediately and reconnects the stream on approve", async () => {
    mockActiveGenerationState.data = null;
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-approval", "conv-1");
      callbacks.onPendingApproval?.({
        interruptId: "interrupt-approval-1",
        generationId: "gen-approval",
        conversationId: "conv-1",
        toolUseId: "tool-approval",
        toolName: "ask_question",
        toolInput: {
          questions: [
            {
              header: "Continue",
              question: "Proceed?",
              options: [{ label: "Yes" }],
            },
          ],
        },
        integration: "cmdclaw",
        operation: "question",
      });
      callbacks.onStatusChange?.("approval_parked");
      return null;
    });

    const { rerender } = render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Continue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => {
      expect(mockSubmitApprovalMutateAsync).toHaveBeenCalledWith({
        interruptId: "interrupt-approval-1",
        decision: "approve",
        questionAnswers: [["Yes"]],
      });
    });

    mockActiveGenerationState.data = {
      generationId: "gen-approval",
      startedAt: "2026-04-10T12:00:00.000Z",
      errorMessage: null,
      status: "awaiting_approval",
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
    };
    rerender(<ChatArea conversationId="conv-1" />);

    await waitFor(() => {
      expect(screen.getByText("Tool Approval approved")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockSubscribeToGeneration).toHaveBeenCalledWith("gen-approval", expect.any(Object));
    });
  });
});
