import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { localizedText } from "@/components/general-translation-provider";
import { getVertical } from "@/components/landing/use-cases-data";
import { VerticalPage } from "@/components/landing/vertical-page";
import { env } from "@/env";

/**
 * Public vertical use-case page (`/cas-usage/<slug>`, e.g. `/cas-usage/notaires`). Each slug is
 * its own SEO target. Content is static (bundled in `use-cases-data`), so the loader resolves
 * the vertical synchronously and throws `notFound()` for an unknown slug; `head` derives the
 * localized SEO metadata + canonical from it.
 *
 * NOTE: same SSR-locale caveat as the hub — `head` defaults to EN on the server; the body
 * localizes on the client. Per-request server-side locale is a tracked follow-up.
 */
const siteUrl = (env.VITE_APP_URL ?? "https://heybap.com").replace(/\/$/, "");

export const Route = createFileRoute("/_public/cas-usage/$vertical")({
  loader: ({ params }) => {
    const vertical = getVertical(params.vertical);
    if (!vertical) {
      throw notFound();
    }
    return { vertical };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) {
      return { meta: [{ title: "Use case not found · HeyBap" }] };
    }
    const { vertical } = loaderData;
    const title = localizedText(vertical.seoTitle.en, { fr: vertical.seoTitle.fr });
    const description = localizedText(vertical.seoDescription.en, {
      fr: vertical.seoDescription.fr,
    });
    const canonical = `${siteUrl}/cas-usage/${params.vertical}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  notFoundComponent: VerticalNotFound,
  component: VerticalRoute,
});

function VerticalNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-center">
      <p className="text-sm text-[#6E5C53]">Use case not found.</p>
      <Link to="/cas-usage" className="mt-3 inline-block text-sm font-medium text-[#D52B0C]">
        ← All use cases
      </Link>
    </main>
  );
}

function VerticalRoute() {
  const { vertical } = Route.useLoaderData();
  return <VerticalPage vertical={vertical} />;
}
