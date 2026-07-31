// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("gt-react", () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CoworkerInfoPrivateRun } from "./coworker-info-private-run";

describe("CoworkerInfoPrivateRun", () => {
  it("explains why another member's run content is unavailable", () => {
    render(<CoworkerInfoPrivateRun />);

    expect(screen.getByRole("heading", { name: "Run details are private" })).toBeTruthy();
    expect(
      screen.getByText(
        "This Coworker was run by another workspace member. Only that person can view its conversation and generated output.",
      ),
    ).toBeTruthy();
  });
});
