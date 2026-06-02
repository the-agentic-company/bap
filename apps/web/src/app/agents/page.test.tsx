// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const {
  mockCreateCoworkerMutateAsync,
  mockUpdateCoworkerMutateAsync,
  mockDeleteCoworkerMutateAsync,
  mockTriggerCoworkerMutateAsync,
  mockExportCoworkerDefinitionMutateAsync,
  mockImportCoworkerDefinitionMutateAsync,
  mockGetOrCreateBuilderConversation,
  mockStartGeneration,
  mockToastSuccess,
  mockToastError,
  mockRouterPush,
  mockCreateObjectURL,
  mockRevokeObjectURL,
} = vi.hoisted(() => ({
  mockCreateCoworkerMutateAsync: vi.fn(),
  mockUpdateCoworkerMutateAsync: vi.fn(),
  mockDeleteCoworkerMutateAsync: vi.fn(),
  mockTriggerCoworkerMutateAsync: vi.fn(),
  mockExportCoworkerDefinitionMutateAsync: vi.fn(),
  mockImportCoworkerDefinitionMutateAsync: vi.fn(),
  mockGetOrCreateBuilderConversation: vi.fn(),
  mockStartGeneration: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockRouterPush: vi.fn(),
  mockCreateObjectURL: vi.fn(),
  mockRevokeObjectURL: vi.fn(),
}));

const mockLocationAssign = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/chat/voice-indicator", () => ({
  VoiceIndicator: () => <div>Voice indicator</div>,
}));

vi.mock("@/components/prompt-bar", () => ({
  PromptBar: ({
    onSubmit,
    renderModelSelector,
  }: {
    onSubmit: (text: string) => void;
    renderModelSelector?: React.ReactNode;
  }) => {
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);

    React.useEffect(() => {
      const button = buttonRef.current;
      if (!button) {
        return;
      }

      const handleSubmit = () => onSubmit("Build me a coworker");
      button.addEventListener("click", handleSubmit);
      return () => button.removeEventListener("click", handleSubmit);
    }, [onSubmit]);

    return (
      <div>
        <div>{renderModelSelector}</div>
        <button ref={buttonRef} type="button">
          Submit prompt
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/chat/model-selector", () => ({
  ModelSelector: ({
    selectedModel,
    onSelectionChange,
  }: {
    selectedModel: string;
    onSelectionChange: (input: { model: string; authSource?: "user" | "shared" | null }) => void;
  }) => {
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);

    React.useEffect(() => {
      const button = buttonRef.current;
      if (!button) {
        return;
      }

      const handleChange = () =>
        onSelectionChange({ model: "openai/gpt-5.2-codex", authSource: "shared" });
      button.addEventListener("click", handleChange);
      return () => button.removeEventListener("click", handleChange);
    }, [onSelectionChange]);

    return (
      <button ref={buttonRef} type="button">
        Model selector: {selectedModel}
      </button>
    );
  },
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    asChild?: boolean;
  }) => {
    if (asChild) {
      return children;
    }
    return (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onSelect} disabled={disabled}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <div />,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({
    children,
    onClick,
    onKeyDown,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  }) => (
    <div onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onSelect} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
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

vi.mock("@/orpc/client", () => ({
  client: {
    coworker: {
      getOrCreateBuilderConversation: mockGetOrCreateBuilderConversation,
    },
    generation: {
      startGeneration: mockStartGeneration,
    },
  },
}));

vi.mock("@/orpc/hooks", () => ({
  useCoworkerList: () => ({
    data: [
      {
        id: "cw-1",
        name: "Inbox triage",
        username: "inbox-triage",
        description: "Sort and summarize inbound work.",
        status: "on",
        triggerType: "manual",
        toolAccessMode: "all",
        allowedIntegrations: [],
        allowedSkillSlugs: [],
        recentRuns: [],
      },
    ],
    isLoading: false,
  }),
  useIntegrationList: () => ({ data: [] }),
  useCreateCoworker: () => ({ mutateAsync: mockCreateCoworkerMutateAsync }),
  useTriggerCoworker: () => ({ mutateAsync: mockTriggerCoworkerMutateAsync }),
  useUpdateCoworker: () => ({ mutateAsync: mockUpdateCoworkerMutateAsync }),
  useDeleteCoworker: () => ({ mutateAsync: mockDeleteCoworkerMutateAsync }),
  useExportCoworkerDefinition: () => ({ mutateAsync: mockExportCoworkerDefinitionMutateAsync }),
  useImportCoworkerDefinition: () => ({
    mutateAsync: mockImportCoworkerDefinitionMutateAsync,
    isPending: false,
  }),
  useShareCoworker: () => ({ mutateAsync: vi.fn() }),
  useUnshareCoworker: () => ({ mutateAsync: vi.fn() }),
  useSharedCoworkerList: () => ({ data: [] }),
  useImportSharedCoworker: () => ({ mutateAsync: vi.fn() }),
  useProviderAuthStatus: () => ({
    data: { connected: { openai: true }, shared: { openai: true } },
  }),
  useTranscribe: () => ({ mutateAsync: vi.fn() }),
  useCoworkerTagList: () => ({ data: [] }),
  useCoworkerViewList: () => ({ data: [] }),
  useCreateCoworkerTag: () => ({ mutateAsync: vi.fn() }),
  useAssignCoworkerTag: () => ({ mutate: vi.fn() }),
  useUnassignCoworkerTag: () => ({ mutate: vi.fn() }),
  useCreateCoworkerView: () => ({ mutateAsync: vi.fn() }),
  useUpdateCoworkerView: () => ({ mutateAsync: vi.fn() }),
  useDeleteCoworkerView: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

import CoworkersPage from "./page";

describe("CoworkersPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockCreateCoworkerMutateAsync.mockReset();
    mockUpdateCoworkerMutateAsync.mockReset();
    mockDeleteCoworkerMutateAsync.mockReset();
    mockTriggerCoworkerMutateAsync.mockReset();
    mockExportCoworkerDefinitionMutateAsync.mockReset();
    mockImportCoworkerDefinitionMutateAsync.mockReset();
    mockGetOrCreateBuilderConversation.mockReset();
    mockStartGeneration.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockRouterPush.mockReset();
    mockCreateObjectURL.mockReset();
    mockRevokeObjectURL.mockReset();
    mockCreateCoworkerMutateAsync.mockResolvedValue({ id: "cw-new" });
    mockUpdateCoworkerMutateAsync.mockResolvedValue({ success: true });
    mockDeleteCoworkerMutateAsync.mockResolvedValue({ success: true });
    mockTriggerCoworkerMutateAsync.mockResolvedValue({ runId: "run-1" });
    mockExportCoworkerDefinitionMutateAsync.mockResolvedValue({
      version: 1,
      exportedAt: "2026-03-26T10:00:00.000Z",
      coworker: {
        name: "Inbox triage",
        description: "Sort and summarize inbound work.",
        username: "inbox-triage",
        status: "on",
        triggerType: "manual",
        prompt: "Do the work",
        model: "openai/gpt-5.4",
        authSource: "shared",
        promptDo: null,
        promptDont: null,
        autoApprove: true,
        toolAccessMode: "all",
        allowedIntegrations: [],
        allowedCustomIntegrations: [],
        allowedSkillSlugs: [],
        schedule: null,
      },
      documents: [],
    });
    mockImportCoworkerDefinitionMutateAsync.mockResolvedValue({ id: "cw-imported" });
    mockGetOrCreateBuilderConversation.mockResolvedValue({ conversationId: "conv-1" });
    mockStartGeneration.mockResolvedValue({ generationId: "gen-1" });
    mockCreateObjectURL.mockReturnValue("blob:export-url");
    mockLocationAssign.mockReset();
    vi.stubGlobal("location", {
      ...window.location,
      assign: mockLocationAssign,
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("turns off a coworker from the card status button", async () => {
    render(<CoworkersPage />);

    fireEvent.click(screen.getByRole("button", { name: /^on$/i }));

    await waitFor(() => {
      expect(mockUpdateCoworkerMutateAsync).toHaveBeenCalledWith({
        id: "cw-1",
        status: "off",
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Coworker turned off.");
  });

  it("deletes a coworker from the card menu after confirmation", async () => {
    render(<CoworkersPage />);

    fireEvent.click(screen.getByRole("button", { name: /delete coworker/i }));
    expect(mockRouterPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockDeleteCoworkerMutateAsync).toHaveBeenCalledWith("cw-1");
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith("Coworker deleted.");
  });

  it("renders the create new coworker card as a link to the builder entrypoint", async () => {
    render(<CoworkersPage />);

    const link = screen.getByRole("link", { name: /create new coworker/i });
    expect(link).toHaveAttribute("href", "/");
  });

  it("navigates to the runs page when running a coworker from the card", async () => {
    render(<CoworkersPage />);

    fireEvent.click(screen.getByRole("button", { name: /run coworker/i }));

    await waitFor(() => {
      expect(mockTriggerCoworkerMutateAsync).toHaveBeenCalledWith({ id: "cw-1", payload: {} });
    });
    expect(mockRouterPush).toHaveBeenCalledWith("/agents/runs/run-1");
  });

  it("exports a coworker definition from the card context menu", async () => {
    render(<CoworkersPage />);

    fireEvent.click(screen.getByRole("button", { name: /export as json/i }));

    await waitFor(() => {
      expect(mockExportCoworkerDefinitionMutateAsync).toHaveBeenCalledWith("cw-1");
    });
    expect(mockCreateObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:export-url");
    expect(mockToastSuccess).toHaveBeenCalledWith("Exported inbox-triage.json.");
    const exportedBlob = mockCreateObjectURL.mock.calls[0]?.[0];
    expect(exportedBlob).toBeInstanceOf(Blob);
    expect((exportedBlob as Blob).type).toBe("application/json");
  });

  it("imports a coworker from a json file on the coworkers page", async () => {
    render(<CoworkersPage />);

    const file = new File(['{"version":1,"coworker":{"name":"Imported"}}'], "coworker.json", {
      type: "application/json",
    });

    fireEvent.change(screen.getByLabelText(/import coworker json file/i), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(mockImportCoworkerDefinitionMutateAsync).toHaveBeenCalledWith(
        '{"version":1,"coworker":{"name":"Imported"}}',
      );
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Coworker imported in the off state.");
    expect(mockRouterPush).toHaveBeenCalledWith("/agents/cw-imported");
  });
});
