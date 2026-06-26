import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    FIRECRAWL_API_KEY: "test-firecrawl-key",
  },
}));

import { scrapeWebsite } from "./firecrawl";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("scrapeWebsite", () => {
  it("keeps the full Firecrawl JSON for LLM analysis", async () => {
    const firecrawlResponse = {
      success: true,
      data: {
        markdown: "# Acme\nBuild better workflows.",
        html: "<html><style>:root{--brand:#12ab34}</style></html>",
        metadata: {
          title: "Acme",
          description: "Workflow software",
        },
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(firecrawlResponse), { status: 200 }));
    globalThis.fetch = fetchMock;

    const result = await scrapeWebsite("acme.test");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v1/scrape",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://acme.test",
          formats: ["markdown", "html"],
        }),
      }),
    );
    expect(result.title).toBe("Acme");
    expect(result.detectedColors).toEqual(["#12ab34"]);
    expect(result.raw).toEqual(firecrawlResponse);
  });
});
