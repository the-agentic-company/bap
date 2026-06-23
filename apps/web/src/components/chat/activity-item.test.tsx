// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityItem, type ActivityItemData } from "./activity-item";

void jestDomVitest;
afterEach(cleanup);

const toolCallFixture: ActivityItemData = {
  id: "tool-1",
  timestamp: 1,
  type: "tool_call",
  content: "Bash",
  toolName: "Bash",
  status: "complete",
  input: { command: "google-gmail list -l 1", description: "Get the latest email" },
  result: "done",
};

const textTableFixture: ActivityItemData = {
  id: "text-1",
  timestamp: 1,
  type: "text",
  content: `| City | Country |\n| --- | --- |\n| Dublin | Ireland |`,
};

const textLinkFixture: ActivityItemData = {
  id: "text-link-1",
  timestamp: 1,
  type: "text",
  content: "[Google](https://google.com)",
};

const longStreamingTextFixture: ActivityItemData = {
  id: "text-long-1",
  timestamp: 1,
  type: "text",
  content:
    "Streaming content can include a very-long-unbroken-token-that-must-not-expand-the-live-activity-pane-outside-the-window",
};

const longThinkingFixture: ActivityItemData = {
  id: "thinking-long-1",
  timestamp: 1,
  type: "thinking",
  content:
    "Thinking about a very-long-unbroken-token-that-must-not-expand-the-live-activity-pane-outside-the-window",
};

const longSystemFixture: ActivityItemData = {
  id: "system-long-1",
  timestamp: 1,
  type: "system",
  content:
    "warning: very-long-unbroken-system-message-that-must-not-expand-the-live-activity-pane-outside-the-window",
};

const longToolLabelFixture: ActivityItemData = {
  id: "tool-long-1",
  timestamp: 1,
  type: "tool_call",
  content: "long-tool",
  toolName: "long-tool",
  status: "running",
  input: {
    description:
      "very-long-unbroken-tool-label-that-must-not-expand-the-live-activity-pane-outside-the-window",
  },
};

const longToolDetailsFixture: ActivityItemData = {
  id: "tool-details-long-1",
  timestamp: 1,
  type: "tool_call",
  content: "Bash",
  toolName: "Bash",
  status: "complete",
  input: {
    command: "command-with-a-very-long-unbroken-token-that-must-wrap-inside-expanded-tool-details",
  },
  result: "result-with-a-very-long-unbroken-token-that-must-wrap-inside-expanded-tool-details",
};

const coworkerToolCallFixture: ActivityItemData = {
  id: "tool-2",
  timestamp: 2,
  type: "tool_call",
  content: "Bash",
  toolName: "Bash",
  status: "running",
  input: {
    command: 'coworker invoke --username linkedin-digest --message "Review this inbox" --json',
  },
};

const agentBrowserToolCallFixture: ActivityItemData = {
  id: "tool-3",
  timestamp: 3,
  type: "tool_call",
  content: "Bash",
  toolName: "Bash",
  status: "complete",
  input: {
    command: "agent-browser screenshot --full /tmp/example.png",
  },
};

const ansiResultToolCallFixture: ActivityItemData = {
  id: "tool-4",
  timestamp: 4,
  type: "tool_call",
  content: "Bash",
  toolName: "Bash",
  status: "complete",
  input: {
    command:
      "agent-browser open https://example.com && agent-browser screenshot /app/example-com.png",
    description: "Opens example.com and captures screenshot",
  },
  result:
    "\u001b[32m✓\u001b[0m \u001b[1mExample Domain\u001b[0m\n  \u001b[2mhttps://example.com/\u001b[0m\n\u001b[32m✓\u001b[0m Done\n\u001b[32m✓\u001b[0m Screenshot saved to \u001b[32m/app/example-com.png\u001b[0m",
};

const executorToolCallFixture: ActivityItemData = {
  id: "tool-5",
  timestamp: 5,
  type: "tool_call",
  content: "linear-mcp.list_issues",
  toolName: "linear-mcp.list_issues",
  status: "complete",
  input: { assignee: "me" },
  result: { ok: true },
};

const executorSourcesFixture = [
  {
    namespace: "linear-mcp",
    kind: "mcp",
    name: "linear-mcp",
    endpoint: "https://mcp.linear.app/mcp",
  },
] as const;

describe("ActivityItem", () => {
  it("renders GFM table content for text activity items", () => {
    render(<ActivityItem item={textTableFixture} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "City" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Dublin" })).toBeInTheDocument();
  });

  it("opens text activity markdown links in a new tab", () => {
    render(<ActivityItem item={textLinkFixture} />);

    const link = screen.getByRole("link", { name: "Google" });
    expect(link).toHaveAttribute("href", "https://google.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("constrains streamed text activity so it wraps inside narrow panes", () => {
    const { container } = render(<ActivityItem item={longStreamingTextFixture} />);

    expect(container.firstElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden",
      "break-words",
      "[overflow-wrap:anywhere]",
      "prose-pre:max-w-full",
      "prose-pre:whitespace-pre-wrap",
      "prose-code:break-words",
    );
  });

  it("constrains thinking and system activity so they wrap inside narrow panes", () => {
    const thinking = render(<ActivityItem item={longThinkingFixture} />);

    expect(thinking.container.firstElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden",
      "break-words",
      "[overflow-wrap:anywhere]",
    );

    cleanup();

    const system = render(<ActivityItem item={longSystemFixture} />);

    expect(system.container.firstElementChild).toHaveClass("min-w-0", "overflow-hidden");
    expect(
      screen.getByText(
        "warning: very-long-unbroken-system-message-that-must-not-expand-the-live-activity-pane-outside-the-window",
      ),
    ).toHaveClass("min-w-0", "break-words", "[overflow-wrap:anywhere]");
  });

  it("constrains tool labels inside the live activity row", () => {
    render(<ActivityItem item={longToolLabelFixture} />);

    expect(
      screen.getByText(
        "very-long-unbroken-tool-label-that-must-not-expand-the-live-activity-pane-outside-the-window",
      ),
    ).toHaveClass("min-w-0", "flex-1", "truncate");
  });

  it("wraps expanded tool details instead of relying on horizontal scrolling", () => {
    const { container } = render(<ActivityItem item={longToolDetailsFixture} />);

    fireEvent.click(screen.getByRole("button", { name: "Show tool details" }));

    const details = container.querySelector(".ml-5");
    const preBlocks = Array.from(container.querySelectorAll("pre"));

    expect(details).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(preBlocks).toHaveLength(2);
    for (const pre of preBlocks) {
      expect(pre).toHaveClass(
        "min-w-0",
        "max-w-full",
        "overflow-hidden",
        "break-words",
        "[overflow-wrap:anywhere]",
        "whitespace-pre-wrap",
      );
      expect(pre).not.toHaveClass("overflow-x-auto");
    }
  });

  it("uses tool input description as the visible label", () => {
    render(<ActivityItem item={toolCallFixture} />);

    expect(screen.getAllByText("Get the latest email").length).toBeGreaterThan(0);
    expect(screen.queryByText("Running command")).not.toBeInTheDocument();
  });

  it("hides tool input and result until details are expanded", () => {
    render(<ActivityItem item={toolCallFixture} />);

    expect(screen.getAllByText("Get the latest email").length).toBeGreaterThan(0);
    expect(screen.queryByText("google-gmail list -l 1")).not.toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show tool details" }));

    expect(screen.getByText("Request (Bash)")).toBeInTheDocument();
    expect(screen.getByText("google-gmail list -l 1")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("uses coworker command metadata for bash activity labels", () => {
    render(<ActivityItem item={coworkerToolCallFixture} />);

    expect(screen.getByText("Invoking coworker")).toBeInTheDocument();
    expect(screen.queryByText("Running command")).not.toBeInTheDocument();
    expect(screen.getByAltText("Coworker")).toBeInTheDocument();
  });

  it("uses agent-browser command metadata for bash activity labels", () => {
    render(<ActivityItem item={agentBrowserToolCallFixture} />);

    expect(screen.getByText("Taking screenshot")).toBeInTheDocument();
    expect(screen.queryByText("Running command")).not.toBeInTheDocument();
    expect(screen.getByAltText("Browser")).toBeInTheDocument();
  });

  it("strips ANSI escape codes from bash results before rendering", () => {
    const { container } = render(<ActivityItem item={ansiResultToolCallFixture} />);

    fireEvent.click(screen.getByRole("button", { name: "Show tool details" }));

    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(container).toHaveTextContent("✓ Example Domain");
    expect(container).toHaveTextContent("https://example.com/");
    expect(container).toHaveTextContent("✓ Done");
    expect(container).toHaveTextContent("✓ Screenshot saved to /app/example-com.png");
    expect(container.textContent).not.toContain("\u001b");
    expect(container.textContent).not.toContain("[32m");
    expect(container.textContent).not.toContain("[0m");
  });

  it("renders native MCP input and uses the mapped integration icon", () => {
    render(
      <ActivityItem item={executorToolCallFixture} executorSources={executorSourcesFixture} />,
    );

    expect(screen.getAllByText("linear-mcp MCP · list issues").length).toBeGreaterThan(0);
    expect(screen.getByAltText("linear-mcp")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show tool details" }));

    expect(screen.getByText("Request (linear-mcp.list_issues)")).toBeInTheDocument();
    expect(screen.getByText(/"assignee": "me"/)).toBeInTheDocument();
    expect(screen.getByText("Response")).toBeInTheDocument();
  });
});
