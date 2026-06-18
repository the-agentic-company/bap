// Shared, hoisted mock state for the ChatArea test suites.
//
// This module owns the single `vi.hoisted(...)` block that every ChatArea mock
// factory and every test file reads from. It is intentionally free of any
// `vi.mock(...)` calls so that both the data-layer and view-layer mock modules
// (and the test files themselves) can import the same mutable state without
// import-order hazards.

import { vi } from "vitest";

export type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

export type ConversationQueuedMessage = {
  id: string;
  content: string;
  status: "queued" | "processing";
  fileAttachments?: Array<{ name: string; mimeType: string; dataUrl: string }>;
  selectedPlatformSkillSlugs?: string[];
  createdAt: string;
};

export type ConversationData = {
  model?: string;
  authSource?: "user" | "shared" | null;
  autoApprove?: boolean;
  type?: "chat" | "coworker";
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    sandboxFiles?: Array<{
      fileId: string;
      path: string;
      filename: string;
      mimeType: string;
      sizeBytes?: number | null;
    }>;
  }>;
};

export type ActiveGenerationData = {
  generationId: string | null;
  startedAt: string | null;
  errorMessage: string | null;
  status: string | null;
  pauseReason: string | null;
  debugRunDeadlineMs: number | null;
  contentParts?: unknown[] | null;
};

/**
 * The shared, mutable mock surface for every ChatArea test file. Tests read and
 * assign fields on the `*State` objects and call `.mockImplementationOnce(...)`
 * etc. on the `mock*` functions to drive a scenario.
 *
 * This is a plain module-level object rather than a `vi.hoisted(...)` block: the
 * `vi.mock(...)` factories that reference it live in sibling modules
 * (`./chat-area.test-mocks-data`, `./chat-area.test-mocks-view`) that import this
 * module before declaring their mocks. Each factory closure runs lazily (when a
 * mocked hook/component is invoked), by which point this import has resolved, so
 * no hoisting of the state itself is required. vitest forbids re-exporting a
 * `vi.hoisted` binding across modules, which is the second reason this stays a
 * plain object.
 */
export const chatAreaMocks = (() => ({
  mockStartGeneration: vi.fn<VitestProcedure>(),
  mockSubscribeToGeneration: vi.fn<VitestProcedure>(),
  mockAbort: vi.fn<VitestProcedure>(),
  mockPosthogCapture: vi.fn<VitestProcedure>(),
  mockInvalidateQueries: vi.fn<VitestProcedure>(),
  mockRefetchQueries: vi.fn<VitestProcedure>(),
  mockSetQueryData: vi.fn<VitestProcedure>(),
  mockSetSelection: vi.fn<VitestProcedure>(),
  mockUseHotkeys: vi.fn<VitestProcedure>(),
  mockConversationGet: vi.fn<VitestProcedure>(),
  mockEnqueueConversationMessageMutateAsync: vi.fn<VitestProcedure>(),
  mockUpdateConversationQueuedMessageMutateAsync: vi.fn<VitestProcedure>(),
  mockConversationQueuedMessagesState: {
    data: undefined as ConversationQueuedMessage[] | undefined,
  },
  mockConversationState: {
    data: null as ConversationData | null,
    isLoading: false,
  },
  mockSubmitApprovalMutateAsync: vi.fn<VitestProcedure>(),
  mockSubmitAuthResultMutateAsync: vi.fn<VitestProcedure>(),
  mockCancelGenerationMutateAsync: vi.fn<VitestProcedure>(),
  mockAdminState: {
    isAdmin: false,
    isLoading: false,
  },
  mockActiveGenerationState: {
    data: null as ActiveGenerationData | null,
  },
}))();
