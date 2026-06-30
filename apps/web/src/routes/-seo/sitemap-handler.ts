import { VERTICALS } from "@/components/landing/use-cases-data";
import { getRequestAwareOrigin } from "@/lib/request-aware-url";
import { SITE_URL } from "@/lib/seo";

/**
 * Framework-neutral handler for `/sitemap.xml`. Lists the home page, the use-cases hub and one URL
 * per vertical (built from `VERTICALS`, never hardcoded). Each entry carries `xhtml:link`
 * hreflang alternates (fr / en / x-default) — all pointing at the same URL, which localizes
 * client-side. Origin is request-derived (allowlisted to `*.heybap.com`), falling back to
 * `SITE_URL`. Served as `application/xml`.
 */
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const HREFLANGS = ["fr", "en", "x-default"] as const;

function resolveOrigin(request: Request): string {
  try {
    return getRequestAwareOrigin(request);
  } catch {
    return SITE_URL;
  }
}

function staticPaths(): string[] {
  const verticalPaths = VERTICALS.map((vertical) => `/cas-usage/${vertical.slug}`);
  return ["/", "/cas-usage", ...verticalPaths];
}

function alternateLinks(absoluteUrl: string): string {
  return HREFLANGS.map(
    (lang) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${absoluteUrl}"/>`,
  ).join("");
}

function urlEntry(origin: string, path: string): string {
  const absoluteUrl = `${origin}${path}`;
  return `<url><loc>${absoluteUrl}</loc>${alternateLinks(absoluteUrl)}</url>`;
}

function buildSitemap(origin: string): string {
  const entries = staticPaths()
    .map((path) => urlEntry(origin, path))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="${XHTML_NS}">${entries}</urlset>`;
}

export function sitemapHandler(request: Request): Response {
  const origin = resolveOrigin(request);
  return new Response(buildSitemap(origin), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
