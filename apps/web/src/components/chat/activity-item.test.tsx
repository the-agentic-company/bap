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
