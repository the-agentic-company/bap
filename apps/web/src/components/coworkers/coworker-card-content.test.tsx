// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CoworkerCardContent } from "./coworker-card-content";

void jestDomVitest;

const coworkerWithUsers = {
  name: "Daily briefing",
  status: "on" as const,
  triggerType: "manual",
  createdByUserId: "user-1",
  createdByNameSnapshot: "Ada Lovelace",
  usedBy: [
    { id: "user-2", name: "Grace Hopper", image: null },
    { id: "user-3", name: "Charlie Johnson", image: null },
    { id: "user-1", name: "Ada Lovelace", image: null },
  ],
};

const unusedCoworker = {
  name: "Daily briefing",
  status: "on" as const,
  triggerType: "manual",
  createdByUserId: "user-3",
  createdByNameSnapshot: "Margaret Hamilton",
  usedBy: [],
};

describe("CoworkerCardContent", () => {
  afterEach(cleanup);

  it("moves the deduplicated creator into the used-by popover", () => {
    render(<CoworkerCardContent coworker={coworkerWithUsers} />);

    const trigger = screen.getByRole("button", {
      name: "Used by Ada Lovelace, Charlie Johnson, Grace Hopper",
    });
    expect(trigger).toHaveTextContent("Used by 3");
    expect(
      screen.getByText("No runs yet").closest("div")?.parentElement?.parentElement,
    ).toContainElement(trigger);

    fireEvent.click(trigger);

    expect(screen.getByText("Ada Lovelace", { selector: "li span.truncate" })).toBeTruthy();
    expect(screen.getByText("Charlie Johnson", { selector: "li span.truncate" })).toBeTruthy();
    expect(screen.getByText("Grace Hopper", { selector: "li span.truncate" })).toBeTruthy();
    expect(
      screen.getAllByRole("listitem").map((item) => item.querySelector(".truncate")?.textContent),
    ).toEqual(["Ada Lovelace", "Charlie Johnson", "Grace Hopper"]);
    expect(screen.getByText("Creator")).toBeTruthy();
    expect(screen.queryByText("Created by", { exact: false })).toBeNull();
  });

  it("includes the creator even before they have run the coworker", () => {
    render(<CoworkerCardContent coworker={unusedCoworker} />);

    const trigger = screen.getByRole("button", { name: "Used by Margaret Hamilton" });
    expect(trigger).toHaveTextContent("Used by 1");

    fireEvent.click(trigger);

    expect(screen.getByText("Margaret Hamilton", { selector: "li span.truncate" })).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
  });
});
