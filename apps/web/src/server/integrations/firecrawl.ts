import { env } from "@/env";

export type WebsiteScrapeResult = {
  url: string;
  title: string | null;
  description: string | null;
  markdown: string;
  detectedColors: string[];
  raw: FirecrawlResponse;
};

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const MAX_MARKDOWN_CHARS = 12_000;

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      ogTitle?: string;
    };
  };
};

/** Pull up to 6 distinct hex colors out of raw HTML/CSS as a palette seed. */
function extractHexColors(html: string): string[] {
  const matches = html.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const normalized = raw.toLowerCase();
    // Skip pure black/white which dominate but carry no brand signal.
    if (
      normalized === "#fff" ||
      normalized === "#ffffff" ||
      normalized === "#000" ||
      normalized === "#000000"
    ) {
      continue;
    }
    seen.add(normalized);
    if (seen.size >= 6) {
      break;
    }
  }
  return [...seen];
}

/** Scrape a company website via Firecrawl and return its content for analysis. */
export async function scrapeWebsite(url: string): Promise<WebsiteScrapeResult> {
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured");
  }

  const target = url.startsWith("http") ? url : `https://${url}`;
  const response = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: target, formats: ["markdown", "html"] }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl scrape failed (${response.status}): ${error}`);
  }

  const data = (await response.json()) as FirecrawlResponse;
  const markdown = (data.data?.markdown ?? "").slice(0, MAX_MARKDOWN_CHARS);
  const html = data.data?.html ?? "";
  return {
    url: target,
    title: data.data?.metadata?.title ?? data.data?.metadata?.ogTitle ?? null,
    description: data.data?.metadata?.description ?? null,
    markdown,
    detectedColors: extractHexColors(html),
    raw: data,
  };
}
