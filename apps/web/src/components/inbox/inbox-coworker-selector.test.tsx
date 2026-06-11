// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { InboxCoworkerSelector, type InboxCoworkerSelectorItem } from "./inbox-coworker-selector";

const coworkers: InboxCoworkerSelectorItem[] = [
  {
    id: "cw-1",
    name: "Galien Pre-Visit Report",
    username: "galien-pre-visit-report",
    description: "Builds pre-visit reports.",
    status: "on",
    triggerType: "manual",
    recentRuns: [{ id: "run-1", status: "completed", startedAt: "2026-06-01T09:00:00.000Z" }],
  },
];

const overflowingCoworkers = Array.from({ length: 16 }, (_, index): InboxCoworkerSelectorItem => {
  const number = index + 1;

  return {
    id: `cw-${number}`,
    name: `Coworker ${number}`,
    username: `coworker-${number}`,
    description: "Builds pre-visit reports.",
    status: "on",
    triggerType: "manual",
    recentRuns: [
      { id: `run-${number}`, status: "completed", startedAt: "2026-06-01T09:00:00.000Z" },
    ],
  };
});

describe("InboxCoworkerSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("selects a coworker and omits the redundant coworker footer badge", () => {
    const handleSelect = vi.fn<VitestProcedure>();

    render(
      <InboxCoworkerSelector
        coworkers={coworkers}
        onSelectCoworker={handleSelect}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /All coworkers/i }));

    expect(screen.queryByText("Coworker")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Galien Pre-Visit Report/i }));

    expect(handleSelect).toHaveBeenCalledWith("cw-1");
  });

  it("clips the coworker list inside a scrollable popover region", () => {
    render(
      <InboxCoworkerSelector
        coworkers={overflowingCoworkers}
        onSelectCoworker={vi.fn<VitestProcedure>()}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /All coworkers/i }));

    expect(screen.getByRole("button", { name: /Coworker 16/i })).toBeTruthy();

    const scrollRegion = screen.getByTestId("inbox-coworker-selector-list");

    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(scrollRegion.className).toContain("max-h-[min(420px,calc(100vh-20rem))]");
  });
});
