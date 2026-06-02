import type React from "react";
import { isSelfHostedEdition } from "@cmdclaw/core/server/edition";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
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

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
    email?: string;
    mode?: string;
    source?: string;
    autoLogin?: string;
  }>;
};

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
          CmdClaw
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </div>
  );
}

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

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  if (params.error === INVITE_ONLY_LOGIN_ERROR) {
    const inviteOnlyUrl = new URL("/invite-only", "http://localhost");
    if (params.email) {
      inviteOnlyUrl.searchParams.set("email", params.email);
    }
    if (params.source) {
      inviteOnlyUrl.searchParams.set("source", params.source);
    }
    redirect(`${inviteOnlyUrl.pathname}${inviteOnlyUrl.search}`);
  }

  const callbackUrl = sanitizeReturnPath(params.callbackUrl, "/chat");
  if (params.autoLogin === "1") {
    redirect(`/api/dev/auto-login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const requestHeaders = await headers();
  const sessionData = await auth.api
    .getSession({
      headers: requestHeaders,
    })
    .catch(() => null);

  if (sessionData?.user?.id) {
    redirect(callbackUrl);
  }

  if (!params.error && isWorktreeAutoLoginConfigured()) {
    redirect(buildWorktreeAutoLoginPath(callbackUrl));
  }

  if (!isSelfHostedEdition()) {
    const errorMessage = getCloudErrorMessage(params.error);
    const initialScreen = params.mode === "getting-started" ? "getting-started" : "login";

    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
        <CloudLoginClient
          callbackUrl={callbackUrl}
          initialError={errorMessage}
          initialScreen={initialScreen}
        />
      </div>
    );
  }

  const errorMessage = getSelfHostedErrorMessage(params.error);
  const hasCloudAuthConfig = Boolean(
    env.CMDCLAW_CLOUD_API_BASE_URL && env.CMDCLAW_CLOUD_INSTANCE_API_KEY,
  );
  const authStartUrl = `/api/instance/auth/start?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <LoginCard
        title="Log in"
        description="Authentication for this self-hosted instance is managed by CmdClaw Cloud."
      >
        {errorMessage ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm">
            {errorMessage}
          </div>
        ) : null}

        {!hasCloudAuthConfig ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            Set `CMDCLAW_CLOUD_API_BASE_URL` and `CMDCLAW_CLOUD_INSTANCE_API_KEY` on this
            self-hosted deployment to enable cloud-managed sign-in.
          </div>
        ) : null}

        {hasCloudAuthConfig ? (
          <Button asChild className="w-full">
            <Link href={authStartUrl}>Continue with CmdClaw Cloud</Link>
          </Button>
        ) : (
          <Button className="w-full" disabled>
            Continue with CmdClaw Cloud
          </Button>
        )}

        <p className="text-muted-foreground text-center text-xs">
          Sign in with Google, magic link, or email and password on CmdClaw Cloud, then return here
          automatically.
        </p>
      </LoginCard>
    </div>
  );
}
