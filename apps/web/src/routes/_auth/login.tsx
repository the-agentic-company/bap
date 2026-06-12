import type React from "react";
import { isSelfHostedEdition } from "@cmdclaw/core/server/edition";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { T, useGT } from "gt-react";
import { CloudLoginClient } from "@/components/login/cloud-login-client";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { INVITE_ONLY_LOGIN_ERROR } from "@/lib/admin-emails";
import { auth } from "@/lib/auth";
import {
  buildWorktreeAutoLoginPath,
  isWorktreeAutoLoginConfigured,
} from "@/lib/worktree-auto-login";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";

type LoginSearch = {
  callbackUrl?: string;
  error?: string;
  email?: string;
  mode?: string;
  source?: string;
  autoLogin?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Behavior-affecting search params for the login page: the post-login callback URL, auth
 * error code, invite-only email/source carry-over, the cloud screen mode, and the dev
 * auto-login flag. Preserved verbatim so existing links (including
 * `/login?autoLogin=1&callbackUrl=...`) keep working.
 */
function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  return {
    callbackUrl: optionalString(search.callbackUrl),
    error: optionalString(search.error),
    email: optionalString(search.email),
    mode: optionalString(search.mode),
    source: optionalString(search.source),
    autoLogin: optionalString(search.autoLogin),
  };
}

type LoginLoaderData =
  | {
      kind: "cloud";
      callbackUrl: string;
      errorMessage: string | null;
      initialScreen: "login" | "getting-started";
    }
  | {
      kind: "selfhost";
      callbackUrl: string;
      errorMessage: string | null;
      hasCloudAuthConfig: boolean;
      authStartUrl: string;
    };

function getSelfHostedErrorMessage(error: string | undefined) {
  switch (error) {
    case INVITE_ONLY_LOGIN_ERROR:
      return "This app is invite-only. Only approved email addresses can sign in.";
    case "cloud_auth_not_configured":
      return "Cloud login is not configured for this self-hosted instance.";
    case "invalid_state":
      return "Your login session expired before the cloud callback completed. Try again.";
    case "invalid_code":
      return "The cloud login code is invalid or has already been used. Try again.";
    case "account_conflict":
      return "This local account is already linked to a different CmdClaw Cloud user.";
    case "cloud_auth_unavailable":
      return "CmdClaw Cloud could not complete the login handshake right now.";
    case "missing_params":
      return "The cloud login callback was missing required parameters.";
    case "cloud_auth_not_available":
      return "Cloud-managed login is only available in self-hosted edition.";
    default:
      return null;
  }
}

function getCloudErrorMessage(error: string | undefined) {
  switch (error) {
    case INVITE_ONLY_LOGIN_ERROR:
      return "This app is invite-only. Only approved email addresses can sign in.";
    default:
      return null;
  }
}

/**
 * Server-side resolution of the login page. Mirrors the old Next server component: it runs
 * the invite-only / auto-login / already-authenticated / worktree redirects (thrown as
 * TanStack redirects so they propagate through the loader) and otherwise returns the render
 * data for the cloud or self-host login screen.
 */
const resolveLoginPage = createServerFn({ method: "GET" })
  .inputValidator((search: LoginSearch) => search)
  .handler(async ({ data: params }): Promise<LoginLoaderData> => {
    if (params.error === INVITE_ONLY_LOGIN_ERROR) {
      const inviteOnlyUrl = new URL("/invite-only", "http://localhost");
      if (params.email) {
        inviteOnlyUrl.searchParams.set("email", params.email);
      }
      if (params.source) {
        inviteOnlyUrl.searchParams.set("source", params.source);
      }
      throw redirect({ href: `${inviteOnlyUrl.pathname}${inviteOnlyUrl.search}` });
    }

    const callbackUrl = sanitizeReturnPath(params.callbackUrl, "/chat");
    if (params.autoLogin === "1") {
      throw redirect({
        href: `/api/dev/auto-login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      });
    }

    const request = getRequest();
    const sessionData = await auth.api.getSession({ headers: request.headers }).catch(() => null);

    if (sessionData?.user?.id) {
      throw redirect({ href: callbackUrl });
    }

    if (!params.error && isWorktreeAutoLoginConfigured()) {
      throw redirect({ href: buildWorktreeAutoLoginPath(callbackUrl) });
    }

    if (!isSelfHostedEdition()) {
      return {
        kind: "cloud",
        callbackUrl,
        errorMessage: getCloudErrorMessage(params.error),
        initialScreen: params.mode === "getting-started" ? "getting-started" : "login",
      };
    }

    return {
      kind: "selfhost",
      callbackUrl,
      errorMessage: getSelfHostedErrorMessage(params.error),
      hasCloudAuthConfig: Boolean(env.APP_CLOUD_API_BASE_URL && env.APP_CLOUD_INSTANCE_API_KEY),
      authStartUrl: `/api/instance/auth/start?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    };
  });

export const Route = createFileRoute("/_auth/login")({
  validateSearch: validateLoginSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => resolveLoginPage({ data: deps }),
  head: () => ({
    meta: [{ title: "Log in - CmdClaw" }],
  }),
  component: LoginPage,
});

function LoginCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border p-6 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
          <T>CmdClaw</T>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </div>
  );
}

function LoginPage() {
  const t = useGT();

  const data = Route.useLoaderData();

  if (data.kind === "cloud") {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
        <CloudLoginClient
          callbackUrl={data.callbackUrl}
          initialError={data.errorMessage}
          initialScreen={data.initialScreen}
        />
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <LoginCard
        title={t("Log in")}
        description="Authentication for this self-hosted instance is managed by CmdClaw Cloud."
      >
        {data.errorMessage ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm">
            {data.errorMessage}
          </div>
        ) : null}

        {!data.hasCloudAuthConfig ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <T>
              Set `APP_CLOUD_API_BASE_URL` and `APP_CLOUD_INSTANCE_API_KEY` on this self-hosted
              deployment to enable cloud-managed sign-in.
            </T>
          </div>
        ) : null}

        {data.hasCloudAuthConfig ? (
          <Button asChild className="w-full">
            {/* API endpoint, not a typed router route: a plain anchor performs the full
                navigation the cloud-managed sign-in handshake requires. */}
            <a href={data.authStartUrl}>
              <T>Continue with CmdClaw Cloud</T>
            </a>
          </Button>
        ) : (
          <Button className="w-full" disabled>
            <T>Continue with CmdClaw Cloud</T>
          </Button>
        )}

        <p className="text-muted-foreground text-center text-xs">
          <T>
            Sign in with Google, magic link, or email and password on CmdClaw Cloud, then return
            here automatically.
          </T>
        </p>
      </LoginCard>
    </div>
  );
}
