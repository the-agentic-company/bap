// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

void jestDomVitest;

vi.mock("@tanstack/react-devtools", () => ({
  TanStackDevtools: () => null,
}));

vi.mock("@tanstack/react-router-devtools", () => ({
  TanStackRouterDevtoolsPanel: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (options: Record<string, unknown>) => ({
    options,
  }),
  HeadContent: () => null,
  Outlet: () => null,
  Scripts: () => null,
}));

vi.mock("@/components/general-translation-provider", () => ({
  GeneralTranslationProvider: ({ children }: { children: React.ReactNode }) => children,
  getInitialAppLocale: () => "en",
  localizedText: (text: string) => text,
}));

import { RootDocument, Route } from "./__root";

describe("root document browser translation policy", () => {
  it("allows browser translation in the server HTML", () => {
    const markup = renderToStaticMarkup(
      <RootDocument>
        <main>React-owned content</main>
      </RootDocument>,
    );

    expect(markup).toContain('<html lang="en" translate="yes">');
  });

  it("does not suppress Google Translate offers", () => {
    const head = (
      Route.options.head as () => {
        meta: Array<{ name?: string; content?: string }>;
      }
    )();

    expect(head.meta).not.toContainEqual({ name: "google", content: "notranslate" });
  });
});
