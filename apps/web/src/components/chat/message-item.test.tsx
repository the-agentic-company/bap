// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import type { SandboxFileData } from "./message-list";
import { MessageItem } from "./message-item";

void jestDomVitest;

vi.mock("@/orpc/hooks/conversation", () => ({
  useDownloadAttachment: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
  useDownloadSandboxFile: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
}));

afterEach(() => {
  cleanup();
});

const sandboxFileFixture: SandboxFileData = {
  fileId: "file-1",
  path: "/app/report.pdf",
  filename: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 42,
};
const sandboxFilesFixture = [sandboxFileFixture];
const duplicatedSandboxFilesFixture: SandboxFileData[] = [
  sandboxFileFixture,
  {
    ...sandboxFileFixture,
    fileId: "file-2",
  },
];

describe("MessageItem", () => {
  it("keeps persisted message rows shrinkable inside narrow panes", () => {
    const { container } = render(
      <MessageItem
        id="message-1"
        messageRole="assistant"
        content="very-long-unbroken-message-token-that-must-not-force-the-chat-pane-to-overlap-output"
      />,
    );

    expect(container.firstElementChild).toHaveClass("min-w-0");
  });

  it("does not render a generated sandbox file twice when the assistant text mentions its path", () => {
    render(
      <MessageItem
        id="message-1"
        messageRole="assistant"
        content="Done - I created `/app/report.pdf`."
        sandboxFiles={sandboxFilesFixture}
      />,
    );

    expect(screen.getAllByRole("button", { name: /report\.pdf/i })).toHaveLength(1);
  });

  it("deduplicates persisted sandbox file rows that point at the same generated file", () => {
    render(
      <MessageItem
        id="message-1"
        messageRole="assistant"
        content="Done - I created **/app/report.pdf**."
        sandboxFiles={duplicatedSandboxFilesFixture}
      />,
    );

    expect(screen.getAllByRole("button", { name: /report\.pdf/i })).toHaveLength(1);
  });
});
