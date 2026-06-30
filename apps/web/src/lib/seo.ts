import { env } from "@/env";

/**
 * Shared technical-SEO constants and tiny helpers for the public marketing pages.
 *
 * `SITE_URL` is the single source of truth for the canonical production origin. It is sourced
 * from the client-exposed `VITE_APP_URL` env var (validated as a URL in `packages/core/src/env.js`)
 * and falls back to `https://heybap.com` — the apex confirmed across `lib/trusted-origins.ts`,
 * `lib/auth.ts` and `lib/request-aware-url.ts` as the real production domain.
 *
 * For server routes that can see the incoming request (robots/sitemap), prefer
 * `getRequestAwareOrigin(request)` from `lib/request-aware-url.ts`, which derives the origin from
 * forwarded headers and only falls back to the configured `APP_URL`/`VITE_APP_URL`. These constants
 * are for the SSR `head()` path, which has no request handle.
 */
export const SITE_URL = (env.VITE_APP_URL ?? "https://heybap.com").replace(/\/$/, "");

/** Marketing site name used in Open Graph / structured data. */
export const SITE_NAME = "HeyBap";

/**
 * Default social-share image. NOTE: this asset does not yet exist in `apps/web/public/og/`.
 * Referencing it is harmless (crawlers tolerate a missing OG image); the PNG still needs to be
 * created and dropped at `apps/web/public/og/heybap.png` (recommended 1200x630).
 */
export const OG_IMAGE_PATH = "/og/heybap.png";
export const OG_IMAGE_URL = `${SITE_URL}${OG_IMAGE_PATH}`;

/** SSR locale rendered by default (gt defaultLocale "en"); the alternate locale is "fr". */
export const OG_LOCALE = "en_US";
export const OG_LOCALE_ALTERNATE = "fr_FR";

export interface MetaTag {
  title?: string;
  name?: string;
  property?: string;
  content?: string;
}

export interface LinkTag {
  rel: string;
  href: string;
  hrefLang?: string;
}

/**
 * Open Graph + Twitter card tags for a page. Kept flat (no branching) so Fallow CRAP stays low.
 * `og:locale:alternate` is added once here so callers never duplicate the block.
 */
export function socialMeta(input: { title: string; description: string; url: string }): MetaTag[] {
  return [
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: input.url },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: OG_LOCALE },
    { property: "og:locale:alternate", content: OG_LOCALE_ALTERNATE },
    { property: "og:image", content: OG_IMAGE_URL },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: OG_IMAGE_URL },
  ];
}

/**
 * Canonical + hreflang alternate links for a page. Single locale set (fr/en/x-default) all point
 * at the same canonical URL since the page is one URL that localizes client-side.
 */
export function alternateLinks(canonical: string): LinkTag[] {
  return [
    { rel: "canonical", href: canonical },
    { rel: "alternate", hrefLang: "fr", href: canonical },
    { rel: "alternate", hrefLang: "en", href: canonical },
    { rel: "alternate", hrefLang: "x-default", href: canonical },
  ];
}
