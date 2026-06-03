import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { InviteOnlyAccessClient } from "@/components/login/invite-only-access-client";
import { auth } from "@/lib/auth";

type InviteOnlySearch = {
  email?: string;
  source?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Behavior-affecting search params for the invite-only access page: the pre-filled `email`
 * and the request `source`, both carried over from the login redirect.
 */
function validateInviteOnlySearch(search: Record<string, unknown>): InviteOnlySearch {
  return {
    email: optionalString(search.email),
    source: optionalString(search.source),
  };
}

/**
 * Server-side gate matching the old Next server component: already-authenticated users are
 * redirected to /chat; everyone else sees the access-request form.
 */
const guardInviteOnly = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (sessionData?.user?.id) {
    throw redirect({ href: "/chat" });
  }
  return null;
});

export const Route = createFileRoute("/_auth/invite-only")({
  validateSearch: validateInviteOnlySearch,
  beforeLoad: () => guardInviteOnly(),
  head: () => ({
    meta: [{ title: "Request access - CmdClaw" }],
  }),
  component: InviteOnlyPage,
});

function InviteOnlyPage() {
  const { email, source } = Route.useSearch();
  return <InviteOnlyAccessClient initialEmail={email} initialSource={source} />;
}
