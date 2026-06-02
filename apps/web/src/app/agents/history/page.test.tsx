// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const { mockUseCoworkerHistory } = vi.hoisted(() => ({
  mockUseCoworkerHistory: vi.fn(),
}));

type MockSelectItemProps = {
  value: string;
  children: React.ReactNode;
};

function MockSelectItem({ children, value }: MockSelectItemProps) {
  return <option value={value}>{children}</option>;
}

function MockSelectValue({ placeholder }: { placeholder?: string }) {
  return <>{placeholder}</>;
}

function visitMockSelectChildren(
  children: React.ReactNode,
  visitor: (
    child: React.ReactElement<{ children?: React.ReactNode; placeholder?: string }>,
  ) => void,
): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }

    const element = child as React.ReactElement<{
      children?: React.ReactNode;
      placeholder?: string;
    }>;
    visitor(element);
    visitMockSelectChildren(element.props.children, visitor);
  });
}

function collectMockSelectOptions(children: React.ReactNode) {
  const options: React.ReactNode[] = [];
  visitMockSelectChildren(children, (child) => {
    if (child.type === MockSelectItem) {
      options.push(child);
    }
  });
  return options;
}

function findMockSelectPlaceholder(children: React.ReactNode) {
  let placeholder = "select";
  visitMockSelectChildren(children, (child) => {
    if (child.type === MockSelectValue && typeof child.props.placeholder === "string") {
      placeholder = child.props.placeholder;
    }
  });
  return placeholder;
}

function MockSelect({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  const label = findMockSelectPlaceholder(children);
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value),
    [onValueChange],
  );

  return (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={handleChange}>
        {collectMockSelectOptions(children)}
      </select>
    </label>
  );
}

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

vi.mock("@/components/coworker-avatar", () => ({
  CoworkerAvatar: ({ username }: { username?: string | null }) => <div>{username ?? "avatar"}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: MockSelect,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: MockSelectItem,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: MockSelectValue,
}));

vi.mock("@/orpc/hooks", () => ({
  useCoworkerHistory: () => mockUseCoworkerHistory(),
}));

import CoworkerHistoryPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "entry-1",
    runId: "run-1",
    toolUseId: "tool-1",
    timestamp: new Date("2026-04-07T09:00:00.000Z"),
    coworker: {
      id: "cw-1",
      name: "Slack Notifier",
      username: "slack-notifier",
    },
    integration: "slack",
    operation: "send",
    operationLabel: "Sending message",
    status: "pending",
    target: "#eng",
    preview: {
      channel: "#eng",
      text: "Deploy in progress",
    },
    ...overrides,
  };
}

function makeHistoryData(entries: ReturnType<typeof makeEntry>[]) {
  return {
    pages: entries.map((entry) => ({
      entries: [entry],
      nextCursor: undefined,
    })),
    pageParams: entries.map(() => undefined),
  };
}

describe("CoworkerHistoryPage", () => {
  it("shows a loading state while history is fetching", () => {
    mockUseCoworkerHistory.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { container } = render(<CoworkerHistoryPage />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("derives real filter options and filters pending entries", () => {
    mockUseCoworkerHistory.mockReturnValue({
      data: makeHistoryData([
        makeEntry(),
        makeEntry({
          id: "entry-2",
          runId: "run-2",
          toolUseId: "tool-2",
          coworker: {
            id: "cw-2",
            name: "GitHub Bot",
            username: "github-bot",
          },
          integration: "github",
          operation: "issues.create",
          operationLabel: "Creating issue",
          status: "success",
          target: "acme/api",
          preview: { repo: "acme/api", title: "Bug" },
        }),
      ]),
      isLoading: false,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<CoworkerHistoryPage />);

    const coworkerSelect = screen.getByLabelText("All coworkers");
    expect(within(coworkerSelect).getByRole("option", { name: "Slack Notifier" })).toBeVisible();
    expect(within(coworkerSelect).getByRole("option", { name: "GitHub Bot" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Pending" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("All status"), { target: { value: "pending" } });

    expect(screen.getByText("#eng")).toBeInTheDocument();
    expect(screen.queryByText("acme/api")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no audit entries", () => {
    mockUseCoworkerHistory.mockReturnValue({
      data: {
        pages: [{ entries: [], nextCursor: undefined }],
        pageParams: [undefined],
      },
      isLoading: false,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<CoworkerHistoryPage />);

    expect(screen.getByText("No matching actions found")).toBeInTheDocument();
  });
});
