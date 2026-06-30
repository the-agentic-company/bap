import { createFileRoute } from "@tanstack/react-router";
import { localizedText } from "@/components/general-translation-provider";
import { UseCasesHub } from "@/components/landing/use-cases-hub";
import { env } from "@/env";

/**
 * Public use-cases hub (`/cas-usage`). Lists every vertical, each linking to its own
 * server-rendered SEO page. Nests under the `_public` shell (no auth guard).
 *
 * NOTE: `head()` resolves the locale from the cookie, which is unavailable during SSR (defaults
 * to EN). The page body localizes correctly on the client via `useAppLocale`. Server-rendering
 * the localized <title>/<meta> per request is a follow-up (read cookie / Accept-Language in a
 * server fn), tracked separately.
 */
const siteUrl = (env.VITE_APP_URL ?? "https://heybap.com").replace(/\/$/, "");
const canonical = `${siteUrl}/cas-usage`;

export const Route = createFileRoute("/_public/cas-usage/")({
  head: () => {
    const title = localizedText("AI agent use cases by profession · HeyBap", {
      fr: "Cas d'usage des agents IA par métier · HeyBap",
    });
    const description = localizedText(
      "Discover the HeyBap agentic apps built for your profession — connected across your tools, with a human approving every step.",
      {
        fr: "Découvrez les apps agentiques HeyBap conçues pour votre métier — connectées à vos outils, avec un humain qui valide chaque étape.",
      },
    );
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { property: "og:type", content: "website" },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: UseCasesHub,
});
