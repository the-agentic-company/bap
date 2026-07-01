import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { localizedText } from "@/components/general-translation-provider";
import { getVertical } from "@/components/landing/use-cases-data";
import { VerticalPage } from "@/components/landing/vertical-page";
import { alternateLinks, SITE_NAME, SITE_URL, socialMeta } from "@/lib/seo";

/**
 * Public vertical use-case page (`/cas-usage/<slug>`, e.g. `/cas-usage/notaires`). Each slug is
 * its own SEO target. Content is static (bundled in `use-cases-data`), so the loader resolves
 * the vertical synchronously and throws `notFound()` for an unknown slug; `head` derives the
 * localized SEO metadata + canonical from it.
 *
 * NOTE: same SSR-locale caveat as the hub — `head` defaults to EN on the server; the body
 * localizes on the client. Per-request server-side locale is a tracked follow-up.
 */

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
    const canonical = `${SITE_URL}/cas-usage/${params.vertical}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: canonical }),
      ],
      links: alternateLinks(canonical),
    };
  },
  notFoundComponent: VerticalNotFound,
  component: VerticalRoute,
});

/**
 * BreadcrumbList structured data (Home › Use cases › <Vertical>) for this route. Lives here, not
 * in `vertical-page.tsx` (which owns FAQPage), so the two JSON-LD blocks stay in separate
 * workstreams. Uses the EN name for the SSR-rendered label, consistent with the head() locale
 * caveat above.
 */
function breadcrumbJsonLd(name: string, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Use cases", item: `${SITE_URL}/cas-usage` },
      { "@type": "ListItem", position: 3, name, item: `${SITE_URL}/cas-usage/${slug}` },
    ],
  };
}

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
  const jsonLd = JSON.stringify(breadcrumbJsonLd(vertical.name.en, vertical.slug));
  return (
    <>
      <script
        type="application/ld+json"
        // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <VerticalPage vertical={vertical} />
    </>
  );
}
