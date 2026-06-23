// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { ActivityFeed, type ActivityItemData } from "./activity-feed";

void jestDomVitest;

vi.mock("@/orpc/hooks/workspace-mcp-servers", () => ({
  useWorkspaceMcpServerList: () => ({ data: { sources: [] } }),
}));

afterEach(cleanup);

const longToolActivity: ActivityItemData = {
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

const DYNAMICS_INTEGRATIONS: DisplayIntegrationType[] = ["dynamics"];
const NOOP_TOGGLE = () => undefined;

function renderActivityFeed(items: ActivityItemData[] = [longToolActivity]) {
  return render(
    <ActivityFeed
      items={items}
      isStreaming
      isExpanded={false}
      onToggleExpand={NOOP_TOGGLE}
      integrationsUsed={DYNAMICS_INTEGRATIONS}
      elapsedMs={44_400}
    />,
  );
}

describe("ActivityFeed", () => {
  it("constrains the panel shell so live activity cannot widen narrow panes", () => {
    const { container } = renderActivityFeed();
    const root = container.firstElementChild;
    const header = container.querySelector("button");
    const scrollContainer = container.querySelector(".overflow-x-hidden");

    expect(root).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(header).toHaveClass("min-w-0", "w-full");
    expect(scrollContainer).toHaveClass("min-w-0", "max-w-full", "overflow-x-hidden");
  });

  it("constrains the initial processing shell before activity items arrive", () => {
    const { container } = renderActivityFeed([]);
    const root = container.firstElementChild;
    const header = container.firstElementChild?.firstElementChild;

    expect(root).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(header).toHaveClass("min-w-0");
  });
});
