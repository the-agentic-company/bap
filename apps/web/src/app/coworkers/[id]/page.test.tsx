// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkerSchedule } from "@/orpc/hooks";

void jestDomVitest;

const {
  mockCoworkerRefetch,
  mockUpdateCoworkerMutateAsync,
  mockGetOrCreateBuilderConversationMutate,
  mockGetOrCreateBuilderConversationMutateAsync,
  mockSetSelectedSkillSlugs,
  mockTriggerCoworkerMutateAsync,
  mockRouterPush,
  mockRouterReplace,
  mockPathnameData,
  mockParamsData,
  mockSearchParamsData,
  mockCoworkerData,
  mockCoworkerRunsData,
  mockCoworkerRunData,
} = vi.hoisted(() => ({
  mockCoworkerRefetch: vi.fn(),
  mockUpdateCoworkerMutateAsync: vi.fn(),
  mockGetOrCreateBuilderConversationMutate: vi.fn(),
  mockGetOrCreateBuilderConversationMutateAsync: vi.fn(),
  mockSetSelectedSkillSlugs: vi.fn(),
  mockTriggerCoworkerMutateAsync: vi.fn(),
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockPathnameData: { current: "/coworkers/cw-1" },
  mockParamsData: { current: { id: "cw-1" } as { id: string; runId?: string } },
  mockSearchParamsData: { current: "" },
  mockCoworkerData: {
    current: {
      id: "cw-1",
      name: "Existing Coworker",
      description: "Existing description",
      username: "existing-user",
      status: "on" as "on" | "off",
      autoApprove: true,
      triggerType: "manual",
      prompt: "Existing prompt",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null as CoworkerSchedule | null,
      createdAt: new Date("2026-03-12T10:00:00.000Z"),
      updatedAt: new Date("2026-03-12T10:00:00.000Z"),
      runs: [],
    },
  },
  mockCoworkerRunsData: {
    current: [] as Array<{
      id: string;
      status: string;
      startedAt: Date;
      finishedAt: Date | null;
      errorMessage: string | null;
    }>,
  },
  mockCoworkerRunData: {
    current: null as {
      id: string;
      coworkerId: string;
      coworkerName: string;
      coworkerUsername: string;
      status: string;
      triggerPayload: Record<string, unknown>;
      generationId: string | null;
      conversationId: string | null;
      startedAt: Date;
      finishedAt: Date | null;
      errorMessage: string | null;
      debugInfo: unknown;
      events: Array<{
        id: string;
        type: string;
        payload: unknown;
        createdAt: Date;
      }>;
    } | null,
  },
}));

function MockContainer({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function MockImage() {
  return <div data-testid="mock-image" />;
}

function MockSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange(event.target.checked);
    },
    [onCheckedChange],
  );

  return <input type="checkbox" checked={checked} onChange={handleChange} />;
}

vi.mock("next/navigation", () => ({
  useParams: () => mockParamsData.current,
  usePathname: () => mockPathnameData.current,
  useSearchParams: () => new URLSearchParams(mockSearchParamsData.current),
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
}));

vi.mock("next/image", () => ({
  default: MockImage,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span {...props}>{children}</span>
    ),
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/chat/chat-area", () => ({
  ChatArea: ({
    onCoworkerSync,
  }: {
    onCoworkerSync?: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  }) => {
    const handleSync = React.useCallback(() => {
      onCoworkerSync?.({
        coworkerId: "cw-1",
        prompt: "Builder patched prompt",
        updatedAt: "2026-03-12T10:05:00.000Z",
      });
    }, [onCoworkerSync]);
    const handleMetadataSync = React.useCallback(() => {
      onCoworkerSync?.({
        coworkerId: "cw-1",
        updatedAt: "2026-03-12T10:05:00.000Z",
      });
    }, [onCoworkerSync]);

    return (
      <div>
        <div>Chat</div>
        <button type="button" onClick={handleSync}>
          Sync coworker
        </button>
        <button type="button" onClick={handleMetadataSync}>
          Sync coworker metadata
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/chat/chat-copy-button", () => ({
  ChatCopyButton: ({ conversationId }: { conversationId?: string }) => (
    <button type="button">Copy {conversationId}</button>
  ),
}));

vi.mock("@/components/chat/model-selector", () => ({
  ModelSelector: ({
    selectedModel,
    onSelectionChange,
  }: {
    selectedModel: string;
    onSelectionChange: (input: { model: string; authSource?: "user" | "shared" | null }) => void;
  }) => {
    const handleClick = React.useCallback(() => {
      onSelectionChange({ model: "openai/gpt-5.4", authSource: "shared" });
    }, [onSelectionChange]);

    return (
      <button type="button" onClick={handleClick}>
        Model selector: {selectedModel}
      </button>
    );
  },
}));

vi.mock("@/components/chat/chat-skill-store", () => ({
  useChatSkillStore: (selector: (state: unknown) => unknown) =>
    selector({
      selectedSkillSlugsByScope: {},
      setSelectedSkillSlugs: mockSetSelectedSkillSlugs,
    }),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  return {
    AlertDialog: MockContainer,
    AlertDialogAction: MockContainer,
    AlertDialogCancel: MockContainer,
    AlertDialogContent: MockContainer,
    AlertDialogDescription: MockContainer,
    AlertDialogFooter: MockContainer,
    AlertDialogHeader: MockContainer,
    AlertDialogTitle: MockContainer,
  };
});

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

vi.mock("@/components/ui/dialog", () => {
  return {
    Dialog: MockContainer,
    DialogContent: MockContainer,
    DialogHeader: MockContainer,
    DialogTitle: MockContainer,
  };
});

vi.mock("@/components/ui/dual-panel-workspace", () => ({
  DualPanelWorkspace: ({
    left,
    right,
    rightCollapsed,
  }: {
    left: React.ReactNode;
    right: React.ReactNode;
    rightCollapsed?: boolean;
  }) => (
    <div>
      <div>{left}</div>
      <div data-testid="mock-right-panel" data-collapsed={String(Boolean(rightCollapsed))}>
        {right}
      </div>
    </div>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  ),
}));

vi.mock("@/components/ui/select", () => {
  return {
    Select: MockContainer,
    SelectContent: MockContainer,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
      <div data-value={value}>{children}</div>
    ),
    SelectTrigger: MockContainer,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  };
});

vi.mock("@/components/ui/switch", () => ({
  Switch: MockSwitch,
}));

vi.mock("@/components/ui/tabs", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const TabsContext = ReactModule.createContext<(key: string) => void>(() => undefined);
  return {
    AnimatedTabs: ({
      children,
      onTabChange,
    }: {
      children: React.ReactNode;
      onTabChange: (key: string) => void;
    }) => <TabsContext.Provider value={onTabChange}>{children}</TabsContext.Provider>,
    AnimatedTab: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onTabChange = ReactModule.useContext(TabsContext);
      const handleClick = ReactModule.useCallback(() => {
        onTabChange(value);
      }, [onTabChange, value]);
      return <button onClick={handleClick}>{children}</button>;
    },
  };
});

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => ({ isAdmin: false }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/orpc/hooks", () => ({
  useCreateCoworkerForwardingAlias: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteCoworkerDocument: () => ({ mutateAsync: vi.fn() }),
  useDisableCoworkerForwardingAlias: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRotateCoworkerForwardingAlias: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCoworker: () => ({
    data: mockCoworkerData.current,
    isLoading: false,
    refetch: mockCoworkerRefetch,
  }),
  useCoworkerImpersonationTarget: () => ({ data: null, isLoading: false }),
  useCoworkerForwardingAlias: () => ({ data: null }),
  useUpdateCoworker: () => ({ mutateAsync: mockUpdateCoworkerMutateAsync }),
  useDeleteCoworker: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCoworkerRun: () => ({ data: mockCoworkerRunData.current, isLoading: false }),
  useCoworkerRunImpersonationTarget: () => ({ data: null, isLoading: false }),
  useCoworkerRuns: () => ({ data: mockCoworkerRunsData.current, refetch: vi.fn() }),
  useEnqueueConversationMessage: () => ({ mutateAsync: vi.fn() }),
  useTriggerCoworker: () => ({ mutateAsync: mockTriggerCoworkerMutateAsync, isPending: false }),
  useGetOrCreateBuilderConversation: () => ({
    mutate: mockGetOrCreateBuilderConversationMutate,
    mutateAsync: mockGetOrCreateBuilderConversationMutateAsync,
  }),
  useExecutorSourceList: () => ({ data: { sources: [] } }),
  usePlatformSkillList: () => ({ data: [], isLoading: false }),
  useProviderAuthStatus: () => ({
    data: {
      connected: {},
      shared: { openai: { connectedAt: new Date("2026-03-12T10:00:00.000Z") } },
    },
  }),
  useRemoteIntegrationTargets: () => ({ data: { targets: [] } }),
  useSearchRemoteIntegrationUsers: () => ({ data: { users: [] }, isFetching: false }),
  useSkillList: () => ({ data: [], isLoading: false }),
  useUploadCoworkerDocument: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import CoworkerEditorPage from "./page";

describe("CoworkerEditorPage", () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    pushStateSpy = vi.spyOn(window.history, "pushState");
    replaceStateSpy = vi.spyOn(window.history, "replaceState");
    mockCoworkerRefetch.mockReset();
    mockUpdateCoworkerMutateAsync.mockReset();
    mockGetOrCreateBuilderConversationMutate.mockReset();
    mockGetOrCreateBuilderConversationMutateAsync.mockReset();
    mockGetOrCreateBuilderConversationMutateAsync.mockResolvedValue({ conversationId: "conv-1" });
    mockSetSelectedSkillSlugs.mockReset();
    mockTriggerCoworkerMutateAsync.mockReset();
    mockRouterPush.mockReset();
    mockRouterReplace.mockReset();
    mockPathnameData.current = "/coworkers/cw-1";
    mockParamsData.current = { id: "cw-1" };
    mockSearchParamsData.current = "";
    mockCoworkerData.current = {
      id: "cw-1",
      name: "Existing Coworker",
      description: "Existing description",
      username: "existing-user",
      status: "on",
      autoApprove: true,
      triggerType: "manual",
      prompt: "Existing prompt",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: new Date("2026-03-12T10:00:00.000Z"),
      updatedAt: new Date("2026-03-12T10:00:00.000Z"),
      runs: [],
    };
    mockCoworkerRunsData.current = [];
    mockCoworkerRunData.current = null;
    mockUpdateCoworkerMutateAsync.mockResolvedValue({ success: true });
    mockTriggerCoworkerMutateAsync.mockResolvedValue({ runId: "run-1" });
  });

  afterEach(() => {
    cleanup();
    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
    vi.clearAllTimers();
  });

  it("hydrates description and username and includes them in autosave updates", async () => {
    render(<CoworkerEditorPage />);

    expect(screen.getByDisplayValue("Existing description")).toBeInTheDocument();
    expect(screen.getByDisplayValue("existing-user")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Existing description"), {
      target: { value: "Updated description" },
    });
    fireEvent.change(screen.getByDisplayValue("existing-user"), {
      target: { value: "updated-user" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockUpdateCoworkerMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cw-1",
        description: "Updated description",
        username: "updated-user",
      }),
    );
  });

  it("hydrates model and includes model changes in autosave updates", async () => {
    render(<CoworkerEditorPage />);

    expect(
      screen.getAllByRole("button", {
        name: /Model selector: anthropic\/claude-sonnet-4-6/i,
      })[0],
    ).toBeInTheDocument();

    for (const button of screen.getAllByRole("button", {
      name: /Model selector: anthropic\/claude-sonnet-4-6/i,
    })) {
      fireEvent.click(button);
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockUpdateCoworkerMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cw-1",
        model: "openai/gpt-5.4",
      }),
    );
  });

  it("does not autosave repeatedly when a hydrated schedule only differs by key order", async () => {
    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      triggerType: "schedule",
      schedule: {
        time: "09:00",
        type: "daily",
        timezone: "Europe/Dublin",
      },
    };

    render(<CoworkerEditorPage />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(mockUpdateCoworkerMutateAsync).not.toHaveBeenCalled();
  });

  it("opens the triggered run when starting a run", async () => {
    render(<CoworkerEditorPage />);

    fireEvent.click(screen.getAllByText("Run now")[0]!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Run not found.")).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/coworkers/cw-1/runs/run-1",
    );
  });

  it("pushes a direct coworker run route when selecting a run", () => {
    mockCoworkerRunsData.current = [
      {
        id: "run-1",
        status: "completed",
        startedAt: new Date("2026-03-12T10:00:00.000Z"),
        finishedAt: new Date("2026-03-12T10:05:00.000Z"),
        errorMessage: null,
      },
    ];

    render(<CoworkerEditorPage />);

    fireEvent.click(screen.getByText("Runs"));
    fireEvent.click(screen.getByRole("button", { name: /completed/i }));

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/coworkers/cw-1/runs/run-1",
    );
    expect(screen.getByText("Run not found.")).toBeInTheDocument();
  });

  it("opens the inline run viewer when loaded on a coworker run route", async () => {
    mockPathnameData.current = "/coworkers/cw-1/runs/run-1";
    mockParamsData.current = { id: "cw-1", runId: "run-1" };

    render(<CoworkerEditorPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Run not found.")).toBeInTheDocument();
  });

  it("allows starting a manual run when the coworker is off", async () => {
    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      status: "off",
    };

    render(<CoworkerEditorPage />);

    const runNowButton = screen.getAllByText("Run now")[0]!.closest("button");
    expect(runNowButton).toBeEnabled();

    fireEvent.click(runNowButton!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockTriggerCoworkerMutateAsync).toHaveBeenCalledWith({ id: "cw-1", payload: {} });
  });

  it("shows the remote integration source banner for persisted remote runs", async () => {
    mockPathnameData.current = "/coworkers/cw-1/runs/run-remote";
    mockParamsData.current = { id: "cw-1", runId: "run-remote" };
    mockCoworkerRunData.current = {
      id: "run-remote",
      coworkerId: "cw-1",
      coworkerName: "Existing Coworker",
      coworkerUsername: "existing-user",
      status: "completed",
      triggerPayload: { source: "manual" },
      generationId: "gen-1",
      conversationId: "conv-1",
      startedAt: new Date("2026-03-12T10:00:00.000Z"),
      finishedAt: new Date("2026-03-12T10:05:00.000Z"),
      errorMessage: null,
      debugInfo: null,
      events: [
        {
          id: "evt-1",
          type: "remote_integration_source",
          payload: {
            targetEnv: "prod",
            remoteUserId: "remote-user-1",
            remoteUserEmail: "remote@example.com",
          },
          createdAt: new Date("2026-03-12T10:00:01.000Z"),
        },
      ],
    };

    render(<CoworkerEditorPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Remote integration source")).toBeInTheDocument();
    expect(screen.getByText("Environment: Production")).toBeInTheDocument();
    expect(screen.getByText("User: remote@example.com")).toBeInTheDocument();
  });

  it("describes cancelled inline runs as cancelled instead of failed", async () => {
    mockPathnameData.current = "/coworkers/cw-1/runs/run-cancelled";
    mockParamsData.current = { id: "cw-1", runId: "run-cancelled" };
    mockCoworkerRunData.current = {
      id: "run-cancelled",
      coworkerId: "cw-1",
      coworkerName: "Existing Coworker",
      coworkerUsername: "existing-user",
      status: "cancelled",
      triggerPayload: { source: "manual" },
      generationId: "gen-1",
      conversationId: "conv-1",
      startedAt: new Date("2026-03-12T10:00:00.000Z"),
      finishedAt: new Date("2026-03-12T10:00:08.000Z"),
      errorMessage: null,
      debugInfo: null,
      events: [],
    };

    render(<CoworkerEditorPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Run cancelled.")).toBeInTheDocument();
    expect(screen.queryByText("Run failed.")).not.toBeInTheDocument();
  });

  it("saves model changes before starting a run", async () => {
    render(<CoworkerEditorPage />);
    for (const button of screen.getAllByRole("button", {
      name: /Model selector: anthropic\/claude-sonnet-4-6/i,
    })) {
      fireEvent.click(button);
    }

    fireEvent.click(screen.getAllByText("Run now")[0]!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdateCoworkerMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.4",
      }),
    );
    expect(mockTriggerCoworkerMutateAsync).toHaveBeenCalledWith({ id: "cw-1", payload: {} });
    expect(mockUpdateCoworkerMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockTriggerCoworkerMutateAsync.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("shows a copy button for the builder conversation", async () => {
    render(<CoworkerEditorPage />);

    await flushMicrotasks();

    expect(screen.getByRole("button", { name: "Copy conv-1" })).toBeInTheDocument();
  });

  it("refreshes the instruction panel when the coworker is patched externally", async () => {
    const { rerender } = render(<CoworkerEditorPage />);

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getAllByText("Existing prompt").length).toBeGreaterThan(0);

    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      prompt: "Builder patched prompt",
      updatedAt: new Date("2026-03-12T10:05:00.000Z"),
    };

    await act(async () => {
      rerender(<CoworkerEditorPage />);
      await Promise.resolve();
    });

    expect(screen.getAllByText("Builder patched prompt").length).toBeGreaterThan(0);
  });

  it("merges an external prompt patch even when another local edit is still unsaved", async () => {
    const { rerender } = render(<CoworkerEditorPage />);

    fireEvent.change(screen.getByDisplayValue("Existing description"), {
      target: { value: "Locally edited description" },
    });

    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      prompt: "Builder patched prompt",
      updatedAt: new Date("2026-03-12T10:05:00.000Z"),
    };

    await act(async () => {
      rerender(<CoworkerEditorPage />);
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue("Locally edited description")).toBeInTheDocument();
    expect(screen.getAllByText("Builder patched prompt").length).toBeGreaterThan(0);
  });

  it("refetches coworker instructions when builder chat reports a coworker sync", async () => {
    mockCoworkerRefetch.mockImplementation(async () => {
      mockCoworkerData.current = {
        ...mockCoworkerData.current,
        prompt: "Builder patched prompt",
        updatedAt: new Date("2026-03-12T10:05:00.000Z"),
      };
      return { data: mockCoworkerData.current };
    });

    const { rerender } = render(<CoworkerEditorPage />);

    await flushMicrotasks();

    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getAllByText("Existing prompt").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sync coworker" }));
      await Promise.resolve();
      rerender(<CoworkerEditorPage />);
      await Promise.resolve();
    });

    expect(mockCoworkerRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getAllByText("Builder patched prompt").length).toBeGreaterThan(0);
  });

  it("collapses the builder panel when there are no instructions", () => {
    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      prompt: "",
    };

    render(<CoworkerEditorPage />);

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "true");
  });

  it("expands the builder panel once a sync adds instructions", async () => {
    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      prompt: "",
    };
    mockCoworkerRefetch.mockImplementation(async () => {
      mockCoworkerData.current = {
        ...mockCoworkerData.current,
        prompt: "Builder patched prompt",
        updatedAt: new Date("2026-03-12T10:05:00.000Z"),
      };
      return { data: mockCoworkerData.current };
    });

    const { rerender } = render(<CoworkerEditorPage />);
    await flushMicrotasks();

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sync coworker" }));
      await Promise.resolve();
      rerender(<CoworkerEditorPage />);
      await Promise.resolve();
    });

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getAllByText("Builder patched prompt").length).toBeGreaterThan(0);
  });

  it("does not expand the builder panel before instructions are updated", async () => {
    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      prompt: "",
    };
    mockCoworkerRefetch.mockImplementation(async () => ({
      data: {
        ...mockCoworkerData.current,
        updatedAt: new Date("2026-03-12T10:05:00.000Z"),
      },
    }));

    render(<CoworkerEditorPage />);
    await flushMicrotasks();

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sync coworker metadata" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "true");
  });

  it("collapses the builder panel when instructions are cleared", async () => {
    const { rerender } = render(<CoworkerEditorPage />);

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "false");

    mockCoworkerData.current = {
      ...mockCoworkerData.current,
      prompt: "",
      updatedAt: new Date("2026-03-12T10:05:00.000Z"),
    };

    await act(async () => {
      rerender(<CoworkerEditorPage />);
      await Promise.resolve();
    });

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "true");
  });

  it("allows manually closing the builder panel while instructions exist", () => {
    render(<CoworkerEditorPage />);

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));

    expect(screen.getByTestId("mock-right-panel")).toHaveAttribute("data-collapsed", "true");
  });

  it("switches right-panel tabs without routing through next navigation", async () => {
    render(<CoworkerEditorPage />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Docs"));

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/coworkers/cw-1?tab=docs",
    );
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("shows a retry when builder conversation loading fails", async () => {
    let shouldFail = true;
    mockGetOrCreateBuilderConversationMutateAsync.mockImplementation(async () => {
      if (shouldFail) {
        throw new Error("Conversation fetch failed");
      }

      return { conversationId: "conv-1" };
    });

    render(<CoworkerEditorPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Failed to load builder chat")).toBeInTheDocument();
    expect(screen.getByText("Conversation fetch failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy conv-1" })).not.toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy conv-1" })).toBeInTheDocument();
  });
});
