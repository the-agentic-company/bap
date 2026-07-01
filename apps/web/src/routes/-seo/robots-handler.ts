import { getRequestAwareOrigin } from "@/lib/request-aware-url";
import { SITE_URL } from "@/lib/seo";

/**
 * Framework-neutral handler for `/robots.txt`. Allows every crawler and points them at the
 * sitemap. The origin is derived from the incoming request (forwarded headers, allowlisted to
 * `*.heybap.com`) so the `Sitemap:` line matches the host the crawler reached us on; it falls
 * back to `SITE_URL` for local/unknown hosts. Returns plain text per the robots.txt spec.
 */
function resolveOrigin(request: Request): string {
  try {
    return getRequestAwareOrigin(request);
  } catch {
    return SITE_URL;
  }
}

export function robotsHandler(request: Request): Response {
  const origin = resolveOrigin(request);
  const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
