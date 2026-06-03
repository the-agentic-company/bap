"use client";

import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { getImpersonationErrorMessage } from "@/routes/admin/-lib/impersonation-errors";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export type ImpersonationTarget = {
  resourceType: "chat" | "coworker" | "coworker_run";
  resourceId: string;
  resourceLabel: string | null;
  owner: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
};

type SessionDataWithImpersonation = {
  session?: {
    impersonatedBy?: string | null;
  };
};

function getResourceNoun(resourceType: ImpersonationTarget["resourceType"]) {
  if (resourceType === "chat") {
    return "chat";
  }
  if (resourceType === "coworker") {
    return "coworker";
  }
  return "coworker run";
}

function readImpersonatedBy(sessionData: SessionDataWithImpersonation | null): string | null {
  const value = sessionData?.session?.impersonatedBy;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function ImpersonationRequiredPage({
  target,
  redirectPath,
  onBack,
}: {
  target: ImpersonationTarget;
  redirectPath: string;
  onBack?: () => void;
}) {
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const ownerLabel = target.owner.name?.trim() || target.owner.email;
  const resourceNoun = getResourceNoun(target.resourceType);
  const resourceLabel = useMemo(() => {
    const label = target.resourceLabel?.trim();
    return label ? `${resourceNoun} ${label}` : `this ${resourceNoun}`;
  }, [resourceNoun, target.resourceLabel]);
  const ownerInitial = target.owner.email.charAt(0).toUpperCase();

  const handleContinue = useCallback(async () => {
    setIsImpersonating(true);
    setErrorMessage(null);
    try {
      const sessionResult = await authClient.getSession();
      if (readImpersonatedBy(sessionResult.data as SessionDataWithImpersonation | null)) {
        const stopResult = await authClient.admin.stopImpersonating();
        if (stopResult.error) {
          setErrorMessage(stopResult.error.message ?? "Unable to stop impersonating.");
          return;
        }
      }

      const result = await authClient.admin.impersonateUser({ userId: target.owner.id });
      if (result.error) {
        setErrorMessage(getImpersonationErrorMessage(result.error));
        return;
      }
      window.location.assign(redirectPath);
    } catch {
      setErrorMessage("Unable to impersonate.");
    } finally {
      setIsImpersonating(false);
    }
  }, [redirectPath, target.owner.id]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
      <div className="border-border/70 bg-background w-full max-w-md rounded-lg border p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
            {target.owner.image ? (
              <img
                src={target.owner.image}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-sm font-semibold">{ownerInitial}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-muted-foreground h-4 w-4" />
              <h2 className="text-foreground text-sm font-semibold">Impersonation required</h2>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {resourceLabel} belongs to {ownerLabel}. Impersonate {target.owner.email} to continue.
            </p>
            {errorMessage ? (
              <p className="text-destructive mt-3 text-sm" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {onBack ? (
                <Button type="button" variant="outline" onClick={onBack}>
                  Back
                </Button>
              ) : null}
              <Button type="button" onClick={handleContinue} disabled={isImpersonating}>
                {isImpersonating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {isImpersonating ? "Switching..." : "Impersonate and continue"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
