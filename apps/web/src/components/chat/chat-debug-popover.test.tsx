// @vitest-environment jsdom

import type React from "react";
import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDebugPopover, type DebugScenarioKey } from "./chat-debug-popover";

void jestDomVitest;

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CREATE_ENABLED_SCENARIOS = ["question", "runtime"] satisfies DebugScenarioKey[];
const CREATE_PROMPT_OVERRIDES = {
  question: "create a coworker that says hi",
  runtime: "create a coworker that says hi",
};
const CREATE_LABEL_OVERRIDES = {
  question: "Create Question",
  runtime: "Create Runtime",
};
const CREATE_DESCRIPTION_OVERRIDES = {
  question: "Builder question park repro",
  runtime: "Builder runtime deadline repro",
};
const EMPTY_SNAPSHOT = {};

describe("ChatDebugPopover", () => {
  afterEach(() => {
    cleanup();
  });

  it("can render create-specific question and runtime presets", () => {
    const onArmPreset = vi.fn();

    render(
      <ChatDebugPopover
        armedPreset={null}
        snapshot={EMPTY_SNAPSHOT}
        enabledScenarios={CREATE_ENABLED_SCENARIOS}
        promptOverrides={CREATE_PROMPT_OVERRIDES}
        labelOverrides={CREATE_LABEL_OVERRIDES}
        descriptionOverrides={CREATE_DESCRIPTION_OVERRIDES}
        onArmPreset={onArmPreset}
        onClearPreset={vi.fn()}
        onResumeRunDeadline={vi.fn()}
      />,
    );

    expect(screen.queryByText("Approval Recovery")).not.toBeInTheDocument();
    expect(screen.queryByText("Auth Recovery")).not.toBeInTheDocument();
    expect(screen.getByText("Question Recovery")).toBeInTheDocument();
    expect(screen.getByText("Runtime Deadline")).toBeInTheDocument();
    expect(screen.getByText("Builder question park repro")).toBeInTheDocument();
    expect(screen.getByText("Builder runtime deadline repro")).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "6" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[0]);

    expect(onArmPreset).toHaveBeenCalledWith({
      key: "question",
      label: "Create Question",
      prompt: "create a coworker that says hi",
      debugApprovalHotWaitMs: 6_000,
    });
  });
});
