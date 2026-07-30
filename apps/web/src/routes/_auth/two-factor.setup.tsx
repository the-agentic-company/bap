import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { TwoFactorEnrollment } from "@/components/auth/two-factor-enrollment";
import { fetchSessionContext } from "@/lib/route-guards";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";

type TwoFactorSetupSearch = {
  callbackUrl?: string;
};

function validateSearch(search: Record<string, unknown>): TwoFactorSetupSearch {
  return {
    callbackUrl:
      typeof search.callbackUrl === "string" && search.callbackUrl.length > 0
        ? search.callbackUrl
        : undefined,
  };
}

export const Route = createFileRoute("/_auth/two-factor/setup")({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const context = await fetchSessionContext();
    const callbackUrl = sanitizeReturnPath(deps.callbackUrl, "/chat");

    if (!context.principal) {
      throw redirect({
        href: `/login?callbackUrl=${encodeURIComponent(
          `/two-factor/setup?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        )}`,
      });
    }

    if (!context.requiresTwoFactorSetup) {
      throw redirect({ href: callbackUrl });
    }

    return {
      callbackUrl,
      twoFactorEnabled: context.principal.twoFactorEnabled === true,
    };
  },
  head: () => ({ meta: [{ title: "Set up two-factor authentication - Bap" }] }),
  component: TwoFactorSetupPage,
});

function TwoFactorSetupPage() {
  const navigate = useNavigate();
  const { callbackUrl, twoFactorEnabled } = Route.useLoaderData();

  const handleComplete = useCallback(() => {
    void navigate({ href: callbackUrl });
  }, [callbackUrl, navigate]);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <div className="bg-card w-full max-w-lg space-y-6 rounded-2xl border p-8 shadow-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
            Bap
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Set up two-factor authentication
          </h1>
          <p className="text-muted-foreground text-sm">
            Your active Workspace requires an authenticator app before you can continue.
          </p>
        </div>
        <TwoFactorEnrollment
          initiallyEnabled={twoFactorEnabled}
          required
          onComplete={handleComplete}
        />
      </div>
    </div>
  );
}
