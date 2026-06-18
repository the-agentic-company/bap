// oxlint-disable import/no-unassigned-import unicorn/consistent-function-scoping

// Shared test-support facade for the ChatArea test suites.
//
// This module is the single seam every ChatArea sibling test file imports. It
// activates the full mocked environment (by importing the data-layer and
// view-layer mock modules for their side effects) and exposes the shared mock
// state, the per-test reset helper, and the render helpers — a deep interface
// over a large amount of mock wiring.
//
// The mock surface is split across three cohesive modules so that no single file
// declares 32+ `vi.mock(...)` factories:
//   - ./chat-area.test-mocks-state — the hoisted, mutable mock state (no mocks)
//   - ./chat-area.test-mocks-data  — orpc hooks, query client, runtime, stores
//   - ./chat-area.test-mocks-view  — rendered child components + UI primitives
//
// vitest hoists the `vi.mock(...)` calls inside those side-effect imports above
// this module's other imports, and this module is imported before a test file's
// own `./chat-area` import. That ordering is what makes the shared mocks take
// effect. Every ChatArea test file MUST import this module BEFORE it imports
// "./chat-area", e.g.
//
//   import { chatAreaMocks, resetChatAreaMocks } from "./chat-area.test-support";
//   import { ChatArea } from "./chat-area";

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

import { ChatHeaderActionsProvider } from "@/components/chat/chat-header-actions-context";

import "./chat-area.test-mocks-data";
import "./chat-area.test-mocks-view";
import { chatAreaMocks, type VitestProcedure } from "./chat-area.test-mocks-state";

void jestDomVitest;

export { chatAreaMocks } from "./chat-area.test-mocks-state";
export type {
  ActiveGenerationData,
  ConversationData,
  ConversationQueuedMessage,
  VitestProcedure,
} from "./chat-area.test-mocks-state";

const {
  mockStartGeneration,
  mockAbort,
  mockInvalidateQueries,
  mockSetQueryData,
  mockSetSelection,
  mockPosthogCapture,
  mockUseHotkeys,
  mockConversationGet,
  mockCancelGenerationMutateAsync,
  mockEnqueueConversationMessageMutateAsync,
  mockUpdateConversationQueuedMessageMutateAsync,
  mockConversationQueuedMessagesState,
  mockConversationState,
  mockAdminState,
  mockActiveGenerationState,
} = chatAreaMocks;

/**
 * Render `children` inside a live `ChatHeaderActionsProvider` so that header
 * actions a ChatArea publishes (for example the admin debug controls) are
 * actually mounted into the tree and become queryable.
 */
export function renderInChatHeader(children: React.ReactNode) {
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

/**
 * Reset the shared mock surface to the default "fresh chat, no admin, no active
 * generation" baseline. Call from `beforeEach`. Mirrors the original suite's
 * setup exactly, including the jsdom shims for `scrollIntoView` and
 * `localStorage`.
 */
export function resetChatAreaMocks() {
  mockStartGeneration.mockReset();
  mockAbort.mockReset();
  mockInvalidateQueries.mockReset();
  mockSetQueryData.mockReset();
  mockSetSelection.mockReset();
  mockPosthogCapture.mockReset();
  mockUseHotkeys.mockReset();
  mockConversationGet.mockReset();
  mockCancelGenerationMutateAsync.mockReset();
  mockEnqueueConversationMessageMutateAsync.mockReset();
  mockUpdateConversationQueuedMessageMutateAsync.mockReset();
  mockConversationQueuedMessagesState.data = undefined;
  mockConversationState.data = null;
  mockConversationState.isLoading = false;
  mockConversationGet.mockResolvedValue({
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
      },
    ],
  });
  mockAdminState.isAdmin = false;
  mockAdminState.isLoading = false;
  mockActiveGenerationState.data = null;
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn<VitestProcedure>(),
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn<VitestProcedure>(() => null),
      setItem: vi.fn<VitestProcedure>(),
      removeItem: vi.fn<VitestProcedure>(),
      clear: vi.fn<VitestProcedure>(),
    },
  });
}
