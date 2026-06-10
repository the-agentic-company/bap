// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

void jestDomVitest;

const { mockIsAdmin } = vi.hoisted(() => ({
  mockIsAdmin: vi.fn<VitestProcedure>(() => false),
}));

afterEach(() => {
  cleanup();
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => ({ isAdmin: mockIsAdmin(), isLoading: false }),
}));

import { ModelSelector } from "./model-selector";

const NO_PROVIDER_AUTH = {
  anthropic: { shared: true, user: false },
  google: { shared: false, user: false },
  openai: { shared: false, user: false },
} as const;
const SHARED_ONLY_AUTH = {
  anthropic: { shared: true, user: false },
  google: { shared: true, user: false },
  openai: { shared: true, user: false },
} as const;
const USER_ONLY_AUTH = {
  anthropic: { shared: true, user: false },
  google: { shared: false, user: false },
  openai: { shared: false, user: true },
} as const;

describe("ModelSelector", () => {
  it("shows shared GPT-5 variants and hides Claude Sonnet 4.6 for non-admins", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(false);

    render(
      <ModelSelector
        selectedModel="openai/gpt-5.4"
        selectedAuthSource="shared"
        providerAvailability={NO_PROVIDER_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(screen.getByText("CmdClaw Models")).toBeInTheDocument();
    expect(screen.getByTestId("chat-model-option-cmdclaw-openai/gpt-5.5")).toBeDisabled();
    expect(screen.getByTestId("chat-model-option-cmdclaw-openai/gpt-5.4")).toBeDisabled();
    expect(screen.getByTestId("chat-model-option-cmdclaw-openai/gpt-5.4-mini")).toBeDisabled();
    expect(
      screen.getByTestId("chat-model-option-cmdclaw-google/gemini-3.1-pro-preview"),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("chat-model-option-cmdclaw-anthropic/claude-sonnet-4-6"),
    ).not.toBeInTheDocument();
  });

  it("shows Claude Sonnet 4.6 for admins", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(true);

    render(
      <ModelSelector
        selectedModel="anthropic/claude-sonnet-4-6"
        selectedAuthSource="shared"
        providerAvailability={NO_PROVIDER_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(
      screen.getByTestId("chat-model-option-cmdclaw-anthropic/claude-sonnet-4-6"),
    ).toBeEnabled();
  });

  it("does not allow selecting shared GPT-5.4 when shared auth is unavailable", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(false);

    render(
      <ModelSelector
        selectedModel="openai/gpt-5.4"
        selectedAuthSource="shared"
        providerAvailability={NO_PROVIDER_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-model-option-cmdclaw-openai/gpt-5.4"));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("selects shared GPT-5.4 when shared auth is available", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(false);

    render(
      <ModelSelector
        selectedModel="openai/gpt-5.4"
        selectedAuthSource="shared"
        providerAvailability={SHARED_ONLY_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-model-option-cmdclaw-openai/gpt-5.4"));

    expect(onSelectionChange).toHaveBeenCalledWith({
      model: "openai/gpt-5.4",
      authSource: "shared",
    });
  });

  it("selects shared GPT-5.5 when shared auth is available", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(false);

    render(
      <ModelSelector
        selectedModel="openai/gpt-5.5"
        selectedAuthSource="shared"
        providerAvailability={SHARED_ONLY_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-model-option-cmdclaw-openai/gpt-5.5"));

    expect(onSelectionChange).toHaveBeenCalledWith({
      model: "openai/gpt-5.5",
      authSource: "shared",
    });
  });

  it("selects shared Gemini when shared auth is available", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(false);

    render(
      <ModelSelector
        selectedModel="google/gemini-3.1-pro-preview"
        selectedAuthSource="shared"
        providerAvailability={SHARED_ONLY_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-model-option-cmdclaw-google/gemini-3.1-pro-preview"));

    expect(onSelectionChange).toHaveBeenCalledWith({
      model: "google/gemini-3.1-pro-preview",
      authSource: "shared",
    });
  });

  it("selects personal GPT-5.4 Mini when user auth is available", () => {
    const onSelectionChange = vi.fn<VitestProcedure>();
    mockIsAdmin.mockReturnValue(false);

    render(
      <ModelSelector
        selectedModel="openai/gpt-5.4-mini"
        selectedAuthSource="user"
        providerAvailability={USER_ONLY_AUTH}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-model-option-user-openai/gpt-5.4-mini"));

    expect(onSelectionChange).toHaveBeenCalledWith({
      model: "openai/gpt-5.4-mini",
      authSource: "user",
    });
  });
});
