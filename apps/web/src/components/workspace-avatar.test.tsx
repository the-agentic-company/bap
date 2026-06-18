// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceAvatar } from "./workspace-avatar";

void jestDomVitest;

describe("WorkspaceAvatar", () => {
  it("falls back to the workspace initial when the image fails to load", () => {
    const { container } = render(<WorkspaceAvatar name="Heybap" imageUrl="/missing.webp" />);
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    fireEvent.error(image!);

    expect(container).toHaveTextContent("H");
    expect(container.querySelector("img")).toBeNull();
  });
});
