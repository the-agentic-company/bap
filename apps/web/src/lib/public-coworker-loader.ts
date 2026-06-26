import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  getPublicCoworkerPage,
  type PublicCoworkerPageData,
} from "@/server/services/public-coworker-page";

export type { PublicCoworkerPageData } from "@/server/services/public-coworker-page";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type SerializedPublicCoworkerPageData = JsonValue;

export const loadPublicCoworkerPage = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string; runId?: string }) => input)
  .handler(async ({ data }): Promise<SerializedPublicCoworkerPageData> => {
    const page = await getPublicCoworkerPage({ slug: data.slug, runId: data.runId });
    if (!page) {
      throw notFound();
    }
    return page as unknown as SerializedPublicCoworkerPageData;
  });

export function loadPublicCoworkerRoute({
  deps,
  params,
}: {
  deps: { runId?: string };
  params: { slug: string };
}): Promise<PublicCoworkerPageData> {
  return loadPublicCoworkerPage({
    data: { slug: params.slug, runId: deps.runId },
  }) as Promise<PublicCoworkerPageData>;
}
