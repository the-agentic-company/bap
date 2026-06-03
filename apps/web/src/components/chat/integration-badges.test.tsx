// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { IntegrationBadges } from "./integration-badges";

void jestDomVitest;
const COWORKER_BADGES: DisplayIntegrationType[] = ["coworker"];

afterEach(cleanup);

describe("IntegrationBadges", () => {
  it("renders the coworker lobster logo badge", () => {
    render(<IntegrationBadges integrations={COWORKER_BADGES} />);

    expect(screen.getByText("Coworker")).toBeInTheDocument();
    expect(screen.getByAltText("Coworker")).toBeInTheDocument();
  });
});
