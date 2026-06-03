import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SharedConversationView } from "@/components/chat/shared-conversation-view";
import {
  getSharedConversationByToken,
  type SharedConversation,
} from "@/server/services/shared-conversation";

/**
 * /shared/$shareToken — public, token-gated shared conversation view (was
 * src/app/shared/[shareToken]/page.tsx).
 *
 * access = public: there is no auth guard. The share token is the access control, and that
 * check lives in the data layer (`getSharedConversationByToken` only returns conversations
 * flagged `isShared`). This is not API authorization — it is a public read keyed on a secret
 * token, exactly as before.
 *
 * The conversation is DB-backed and resolves presigned download URLs, so the dynamic head
 * title needs server work: the loader fetches the shared conversation once (throwing
 * `notFound()` when the token does not match a shared conversation) and `head` derives the
 * title from that loader data. The page keeps its user-facing not-found behavior via a
 * route-specific notFoundComponent, matching the original `notFound()` call.
 */
/**
 * `SharedConversation` carries `Record<string, unknown>` / `unknown` content-part fields (DB
 * JSON), which TanStack Start's server-function return validator rejects even though the data
 * is plain JSON at runtime. We declare the boundary as an explicit JSON value type (which the
 * validator accepts) and re-attach the real `SharedConversation` type on consumption.
 */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type SerializedSharedConversation = {
  title: string;
  messages: JsonValue[];
};

const loadSharedConversation = createServerFn({ method: "GET" })
  .inputValidator((shareToken: string) => shareToken)
  .handler(async ({ data: shareToken }): Promise<SerializedSharedConversation> => {
    const shared = await getSharedConversationByToken(shareToken);
    if (!shared) {
      throw notFound();
    }
    return { title: shared.title, messages: shared.messages as unknown as JsonValue[] };
  });

export const Route = createFileRoute("/shared/$shareToken")({
  loader: ({ params }) => loadSharedConversation({ data: params.shareToken }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? "Shared conversation"} | CmdClaw` }],
  }),
  notFoundComponent: SharedConversationNotFound,
  component: SharedConversationPage,
});

function SharedConversationNotFound() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium">Shared conversation not found</p>
      <p className="text-muted-foreground text-sm">
        This conversation may have been unshared or the link is invalid.
      </p>
    </div>
  );
}

function SharedConversationPage() {
  const shared = Route.useLoaderData() as unknown as SharedConversation;

  return <SharedConversationView title={shared.title} messages={shared.messages} />;
}
