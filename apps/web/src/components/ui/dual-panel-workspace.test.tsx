// oxlint-disable unicorn/consistent-function-scoping

// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DualPanelWorkspace } from "./dual-panel-workspace";

void jestDomVitest;

afterEach(() => {
  cleanup();
});

describe("DualPanelWorkspace", () => {
  it("forces the right panel min-width to zero when collapsed", () => {
    const { container } = render(
      <DualPanelWorkspace
        left="Left panel"
        right="Right panel"
        collapsible
        rightPanelClassName="md:min-w-[34rem]"
        showTitles={false}
        hideMobileToggle
      />,
    );

    const rightSection = container.querySelectorAll("section")[1];

    fireEvent.click(screen.getByRole("button", { name: "Collapse right panel" }));

    expect(rightSection).toHaveStyle({ width: "0%", minWidth: "0px" });
  });

  it("renders the controlled collapsed state", () => {
    const { container } = render(
      <DualPanelWorkspace
        left="Left panel"
        right="Right panel"
        collapsible
        rightCollapsed
        rightPanelClassName="md:min-w-[34rem]"
        showTitles={false}
        hideMobileToggle
      />,
    );

    const rightSection = container.querySelectorAll("section")[1];

    expect(screen.getByRole("button", { name: "Expand right panel" })).toBeInTheDocument();
    expect(rightSection).toHaveStyle({ width: "0%", minWidth: "0px" });
  });

  it("calls the controlled collapse callback", () => {
    function ControlledHarness() {
      const [rightCollapsed, setRightCollapsed] = useState(false);

      return (
        <DualPanelWorkspace
          left="Left panel"
          right="Right panel"
          collapsible
          rightCollapsed={rightCollapsed}
          onRightCollapsedChange={setRightCollapsed}
          rightPanelClassName="md:min-w-[34rem]"
          showTitles={false}
          hideMobileToggle
        />
      );
    }

    render(<ControlledHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse right panel" }));
    expect(screen.getByRole("button", { name: "Expand right panel" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand right panel" }));
    expect(screen.getByRole("button", { name: "Collapse right panel" })).toBeInTheDocument();
  });

  it("resizes panels from separator drags", () => {
    const { container } = render(
      <DualPanelWorkspace
        left="Left panel"
        right="Right panel"
        defaultRightWidth={40}
        minLeftWidth={20}
        minRightWidth={20}
        showTitles={false}
        hideMobileToggle
      />,
    );
    const desktopContainer = screen.getByRole("separator").parentElement;
    Object.defineProperty(desktopContainer, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        width: 1000,
        top: 0,
        right: 1000,
        bottom: 600,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const separator = screen.getByRole("separator");
    const [leftSection, rightSection] = Array.from(container.querySelectorAll("section"));

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 600 });

    expect(leftSection).toHaveClass("pointer-events-none");
    expect(rightSection).toHaveClass("pointer-events-none");

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 650 });

    expect(leftSection).toHaveStyle({ width: "65%" });
    expect(rightSection).toHaveStyle({ width: "35%" });

    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(leftSection).not.toHaveClass("pointer-events-none");
    expect(rightSection).not.toHaveClass("pointer-events-none");
  });

  it("can mask and restore the left panel by dragging past the minimum", () => {
    const { container } = render(
      <DualPanelWorkspace
        left="Left panel"
        right="Right panel"
        defaultRightWidth={75}
        minLeftWidth={25}
        minRightWidth={40}
        allowLeftPanelDragCollapse
        showTitles={false}
        hideMobileToggle
      />,
    );
    const desktopContainer = screen.getByRole("separator").parentElement;
    Object.defineProperty(desktopContainer, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        width: 1000,
        top: 0,
        right: 1000,
        bottom: 600,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const separator = screen.getByRole("separator");
    const [leftSection, rightSection] = Array.from(container.querySelectorAll("section"));

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 250 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120 });

    expect(leftSection).toHaveStyle({ width: "0%", minWidth: "0px" });
    expect(rightSection).toHaveStyle({ width: "100%" });

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 });

    expect(leftSection).toHaveStyle({ width: "30%" });
    expect(rightSection).toHaveStyle({ width: "70%" });
  });
});
