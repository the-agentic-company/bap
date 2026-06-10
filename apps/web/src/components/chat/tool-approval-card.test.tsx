// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { ToolApprovalCard } from "./tool-approval-card";

void jestDomVitest;

const QUESTION_TOOL_INPUT = {
  questions: [
    {
      header: "Pick",
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
      custom: true,
    },
  ],
};
const APPROVED_QUESTION_ANSWERS = [["Beta"]];
const MULTI_APPROVED_ANSWERS: string[][] = [["A"], ["D"], ["E"]];

const MULTI_QUESTION_TOOL_INPUT = {
  questions: [
    {
      header: "First",
      question: "Choose first",
      options: [{ label: "A" }, { label: "B" }],
      custom: true,
    },
    {
      header: "Second",
      question: "Choose second",
      options: [{ label: "C" }, { label: "D" }],
      custom: true,
    },
    {
      header: "Third",
      question: "Choose third",
      options: [{ label: "E" }, { label: "F" }],
      custom: false,
    },
  ],
};

function cloneToolInput<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const COWORKER_APPROVAL_TOOL_INPUT = {
  command: 'coworker invoke --username linkedin-digest --message "Review this inbox" --json',
};

const AGENT_BROWSER_APPROVAL_TOOL_INPUT = {
  command: "agent-browser screenshot --full /tmp/example.png",
};

afterEach(() => {
  cleanup();
});

describe("ToolApprovalCard", () => {
  it("submits a typed custom answer with the submit button", () => {
    const onApprove = vi.fn<VitestProcedure>();

    render(
      <ToolApprovalCard
        toolUseId="question-1"
        toolName="question"
        toolInput={QUESTION_TOOL_INPUT}
        integration="cmdclaw"
        operation="question"
        onApprove={onApprove}
        onDeny={vi.fn<VitestProcedure>()}
        status="pending"
      />,
    );

    fireEvent.click(screen.getByTestId("question-typed-toggle-0"));
    fireEvent.change(screen.getByTestId("question-typed-input-0"), {
      target: { value: "Gamma" },
    });
    fireEvent.click(screen.getByTestId("question-typed-submit-0"));

    expect(onApprove).toHaveBeenCalledWith([["Gamma"]]);
  });

  it("renders approved questions with the prompt and saved answer", () => {
    render(
      <ToolApprovalCard
        toolUseId="question-2"
        toolName="question"
        toolInput={QUESTION_TOOL_INPUT}
        integration="cmdclaw"
        operation="question"
        command="Question: undefined"
        questionAnswers={APPROVED_QUESTION_ANSWERS}
        onApprove={vi.fn<VitestProcedure>()}
        onDeny={vi.fn<VitestProcedure>()}
        status="approved"
      />,
    );

    expect(screen.getAllByText("Choose one")).not.toHaveLength(0);
    expect(screen.getByText("Saved answer")).toBeInTheDocument();
    expect(screen.getAllByText("Beta")).not.toHaveLength(0);
    expect(screen.queryByText("Question: undefined")).not.toBeInTheDocument();
  });

  describe("multi-question wizard", () => {
    it("shows only the first question initially with dot indicators", () => {
      render(
        <ToolApprovalCard
          toolUseId="wiz-1"
          toolName="question"
          toolInput={MULTI_QUESTION_TOOL_INPUT}
          integration="cmdclaw"
          operation="question"
          onApprove={vi.fn<VitestProcedure>()}
          onDeny={vi.fn<VitestProcedure>()}
          status="pending"
        />,
      );

      // First question visible
      expect(screen.getByText("Choose first")).toBeInTheDocument();
      // Second question NOT visible
      expect(screen.queryByText("Choose second")).not.toBeInTheDocument();
      // Dot indicators present
      expect(screen.getByLabelText("Question 1 of 3")).toBeInTheDocument();
    });

    it("auto-advances to next question on single-select click", () => {
      const onApprove = vi.fn<VitestProcedure>();

      render(
        <ToolApprovalCard
          toolUseId="wiz-2"
          toolName="question"
          toolInput={MULTI_QUESTION_TOOL_INPUT}
          integration="cmdclaw"
          operation="question"
          onApprove={onApprove}
          onDeny={vi.fn<VitestProcedure>()}
          status="pending"
        />,
      );

      // Click first option on first question
      fireEvent.click(screen.getByTestId("question-option-0-A"));

      // Now second question should be visible (step change is synchronous)
      expect(screen.getByText("Choose second")).toBeInTheDocument();
      expect(screen.queryByText("Choose first")).not.toBeInTheDocument();

      // Not yet submitted (still has more questions)
      expect(onApprove).not.toHaveBeenCalled();
    });

    it("can go back to a previous question and change the saved answer", () => {
      const onApprove = vi.fn<VitestProcedure>();

      render(
        <ToolApprovalCard
          toolUseId="wiz-back"
          toolName="question"
          toolInput={MULTI_QUESTION_TOOL_INPUT}
          integration="cmdclaw"
          operation="question"
          onApprove={onApprove}
          onDeny={vi.fn<VitestProcedure>()}
          status="pending"
        />,
      );

      fireEvent.click(screen.getByTestId("question-option-0-A"));
      expect(screen.getByText("Choose second")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /back/i }));
      expect(screen.getByText("Choose first")).toBeInTheDocument();
      expect(screen.getByTestId("question-option-0-A")).toHaveClass("border-primary");

      fireEvent.click(screen.getByTestId("question-option-0-B"));
      fireEvent.click(screen.getByTestId("question-option-1-D"));
      fireEvent.click(screen.getByTestId("question-option-2-E"));

      expect(onApprove).toHaveBeenCalledWith([["B"], ["D"], ["E"]]);
    });

    it("submits all answers after answering the last question", () => {
      const onApprove = vi.fn<VitestProcedure>();

      render(
        <ToolApprovalCard
          toolUseId="wiz-3"
          toolName="question"
          toolInput={MULTI_QUESTION_TOOL_INPUT}
          integration="cmdclaw"
          operation="question"
          onApprove={onApprove}
          onDeny={vi.fn<VitestProcedure>()}
          status="pending"
        />,
      );

      // Answer question 1
      fireEvent.click(screen.getByTestId("question-option-0-A"));

      // Answer question 2
      fireEvent.click(screen.getByTestId("question-option-1-D"));

      // Answer question 3 (last one)
      fireEvent.click(screen.getByTestId("question-option-2-E"));

      // Should have submitted with all answers
      expect(onApprove).toHaveBeenCalledWith([["A"], ["D"], ["E"]]);
    });

    it("keeps wizard progress when the parent refreshes the same question request", () => {
      const onApprove = vi.fn<VitestProcedure>();
      const props = {
        toolUseId: "wiz-refresh",
        toolName: "question",
        integration: "cmdclaw",
        operation: "question",
        onApprove,
        onDeny: vi.fn<VitestProcedure>(),
        status: "pending" as const,
      };

      const { rerender } = render(
        <ToolApprovalCard {...props} toolInput={cloneToolInput(MULTI_QUESTION_TOOL_INPUT)} />,
      );

      fireEvent.click(screen.getByTestId("question-option-0-A"));
      expect(screen.getByText("Choose second")).toBeInTheDocument();

      rerender(
        <ToolApprovalCard {...props} toolInput={cloneToolInput(MULTI_QUESTION_TOOL_INPUT)} />,
      );

      expect(screen.getByText("Choose second")).toBeInTheDocument();
      expect(screen.queryByText("Choose first")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("question-option-1-D"));
      fireEvent.click(screen.getByTestId("question-option-2-E"));

      expect(onApprove).toHaveBeenCalledWith([["A"], ["D"], ["E"]]);
    });

    it("does not answer a readonly pending question card", () => {
      const onApprove = vi.fn<VitestProcedure>();
      const onDeny = vi.fn<VitestProcedure>();

      render(
        <ToolApprovalCard
          toolUseId="readonly-question"
          toolName="question"
          toolInput={MULTI_QUESTION_TOOL_INPUT}
          integration="cmdclaw"
          operation="question"
          onApprove={onApprove}
          onDeny={onDeny}
          status="pending"
          readonly
        />,
      );

      fireEvent.click(screen.getByTestId("question-option-0-A"));
      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

      expect(screen.getByText("Choose first")).toBeInTheDocument();
      expect(screen.queryByText("Choose second")).not.toBeInTheDocument();
      expect(onApprove).not.toHaveBeenCalled();
      expect(onDeny).not.toHaveBeenCalled();
    });

    it("shows all saved answers in completed state", () => {
      render(
        <ToolApprovalCard
          toolUseId="wiz-4"
          toolName="question"
          toolInput={MULTI_QUESTION_TOOL_INPUT}
          integration="cmdclaw"
          operation="question"
          questionAnswers={MULTI_APPROVED_ANSWERS}
          onApprove={vi.fn<VitestProcedure>()}
          onDeny={vi.fn<VitestProcedure>()}
          status="approved"
        />,
      );

      // All questions and answers should be visible
      expect(screen.getByText("Choose first")).toBeInTheDocument();
      expect(screen.getByText("Choose second")).toBeInTheDocument();
      expect(screen.getByText("Choose third")).toBeInTheDocument();
      expect(screen.getAllByText("Saved answer")).toHaveLength(3);
    });
  });

  it("uses coworker command metadata for the approval header", () => {
    render(
      <ToolApprovalCard
        toolUseId="coworker-1"
        toolName="Bash"
        toolInput={COWORKER_APPROVAL_TOOL_INPUT}
        integration="cmdclaw"
        operation="patch"
        command='coworker invoke --username linkedin-digest --message "Review this inbox" --json'
        onApprove={vi.fn<VitestProcedure>()}
        onDeny={vi.fn<VitestProcedure>()}
        status="pending"
      />,
    );

    expect(screen.getByText("Coworker")).toBeInTheDocument();
    expect(screen.getByText("invoke")).toBeInTheDocument();
    expect(screen.queryByText("cmdclaw")).not.toBeInTheDocument();
    expect(screen.queryByText("patch")).not.toBeInTheDocument();
  });

  it("uses agent-browser command metadata for the approval header", () => {
    render(
      <ToolApprovalCard
        toolUseId="agent-browser-1"
        toolName="Bash"
        toolInput={AGENT_BROWSER_APPROVAL_TOOL_INPUT}
        integration="cmdclaw"
        operation="patch"
        command="agent-browser screenshot --full /tmp/example.png"
        onApprove={vi.fn<VitestProcedure>()}
        onDeny={vi.fn<VitestProcedure>()}
        status="pending"
      />,
    );

    expect(screen.getByText("Browser")).toBeInTheDocument();
    expect(screen.getByText("screenshot")).toBeInTheDocument();
    expect(screen.getByAltText("Browser")).toBeInTheDocument();
    expect(screen.queryByText("cmdclaw")).not.toBeInTheDocument();
    expect(screen.queryByText("patch")).not.toBeInTheDocument();
  });
});
