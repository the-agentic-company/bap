// Data-layer mock factories for the ChatArea test suites.
//
// Importing this module for its side effects registers `vi.mock(...)` for every
// data dependency ChatArea touches: the query client, generation/conversation
// orpc hooks, the generation runtime, the chat model/skill stores, posthog, and
// hotkeys. It is one half of the shared mock surface; the view-layer component
// mocks live in `./chat-area.test-mocks-view`. Both halves read the same hoisted
// state from `./chat-area.test-mocks-state`.
//
// vitest hoists the top-level `vi.mock(...)` calls in this module above its
// imports, and the module's side-effect import in `./chat-area.test-support`
// runs before any test file imports `./chat-area`. That is what lets every split
// test file reuse this mock surface without redeclaring it.

import { vi } from "vitest";

import { chatAreaMocks, type VitestProcedure } from "./chat-area.test-mocks-state";

const {
  mockStartGeneration,
  mockSubscribeToGeneration,
  mockAbort,
  mockPosthogCapture,
  mockInvalidateQueries,
  mockRefetchQueries,
  mockSetQueryData,
  mockSetSelection,
  mockUseHotkeys,
  mockConversationGet,
  mockEnqueueConversationMessageMutateAsync,
  mockUpdateConversationQueuedMessageMutateAsync,
  mockConversationQueuedMessagesState,
  mockConversationState,
  mockAdminState,
  mockActiveGenerationState,
  mockSubmitApprovalMutateAsync,
  mockSubmitAuthResultMutateAsync,
  mockCancelGenerationMutateAsync,
} = chatAreaMocks;

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

vi.mock("@/hooks/use-voice-recording", () => ({
  blobToBase64: vi.fn<VitestProcedure>(),
  useVoiceRecording: () => ({
    isRecording: false,
    error: null,
    startRecording: vi.fn<VitestProcedure>(),
    stopRecording: vi.fn<VitestProcedure>(),
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
          questionAnswers?: string[][];
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
      handleText: vi.fn<VitestProcedure>(),
      handleSystem: vi.fn<VitestProcedure>(),
      handleThinking: vi.fn<VitestProcedure>(),
      handleToolUse: vi.fn<VitestProcedure>(
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
      handleToolResult: vi.fn<VitestProcedure>(),
      handlePendingApproval: vi.fn<VitestProcedure>(
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
      handleApprovalResult: vi.fn<VitestProcedure>(),
      handleApproval: vi.fn<VitestProcedure>(),
      handleAuthNeeded: vi.fn<VitestProcedure>(
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
      handleAuthProgress: vi.fn<VitestProcedure>(),
      handleAuthResult: vi.fn<VitestProcedure>(),
      handleSandboxFile: vi.fn<VitestProcedure>(),
      handleDone: vi.fn<VitestProcedure>(),
      handleCancelled: vi.fn<VitestProcedure>(),
      handleError: vi.fn<VitestProcedure>(),
      setStatus: vi.fn<VitestProcedure>(),
      setApprovalStatus: vi.fn<VitestProcedure>(
        (toolUseId: string, status: "approved" | "denied", questionAnswers?: string[][]) => {
          const segment = snapshot.segments.find(
            (value) => value.approval?.toolUseId === toolUseId,
          );
          if (segment?.approval) {
            segment.approval = {
              ...segment.approval,
              status,
              questionAnswers,
            };
          }
          snapshot.traceStatus = "streaming";
        },
      ),
      setAuthConnecting: vi.fn<VitestProcedure>(),
      setAuthPending: vi.fn<VitestProcedure>(),
      setAuthCancelled: vi.fn<VitestProcedure>(),
      resolveAuthSuccess: vi.fn<VitestProcedure>((integration: string) => {
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
      get: mockConversationGet,
    },
  },
}));

vi.mock("@/orpc/hooks/conversation", () => ({
  useConversation: () => mockConversationState,
  useUpdateAutoApprove: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
}));

vi.mock("@/orpc/hooks/generation", () => ({
  useGeneration: () => ({
    startGeneration: mockStartGeneration,
    subscribeToGeneration: mockSubscribeToGeneration,
    abort: mockAbort,
  }),
  useSubmitApproval: () => ({ mutateAsync: mockSubmitApprovalMutateAsync, isPending: false }),
  useSubmitAuthResult: () => ({ mutateAsync: mockSubmitAuthResultMutateAsync, isPending: false }),
  useGetAuthUrl: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
  useActiveGeneration: () => mockActiveGenerationState,
  useCancelGeneration: () => ({ mutateAsync: mockCancelGenerationMutateAsync }),
  useDetectUserMessageLanguage: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
  useConversationQueuedMessages: () => ({ data: mockConversationQueuedMessagesState.data }),
  useEnqueueConversationMessage: () => ({ mutateAsync: mockEnqueueConversationMessageMutateAsync }),
  useRemoveConversationQueuedMessage: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
  useUpdateConversationQueuedMessage: () => ({
    mutateAsync: mockUpdateConversationQueuedMessageMutateAsync,
  }),
}));

vi.mock("@/orpc/hooks/integrations", () => ({
  useGetAuthUrl: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
}));

vi.mock("@/orpc/hooks/provider-auth", () => ({
  useProviderAuthStatus: () => ({ data: { connected: {}, shared: {} } }),
  useOpencodeFreeModels: () => ({ data: { models: [] } }),
}));

vi.mock("@/orpc/hooks/skills", () => ({
  usePlatformSkillList: () => ({ data: [], isLoading: false }),
  useSkillList: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/orpc/hooks/voice", () => ({
  useTranscribe: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
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

vi.mock("./chat-model-store", () => ({
  useChatModelStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedModel: "anthropic/claude-sonnet-4-6",
      selectedAuthSource: null,
      setSelection: mockSetSelection,
    }),
}));

vi.mock("./chat-skill-store", () => ({
  useChatSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedSkillSlugsByScope: {},
      toggleSelectedSkillSlug: vi.fn<VitestProcedure>(),
      clearSelectedSkillSlugs: vi.fn<VitestProcedure>(),
    }),
}));

vi.mock("./question-approval-utils", () => ({
  collectQuestionApprovalToolUseIds: () => new Set<string>(),
  isQuestionApprovalRequest: () => false,
}));
