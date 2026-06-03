"use client";

import { useCallback, useEffect, useState } from "react";
import { AppLink } from "@/components/app-link";
import { usePathname } from "@/components/next-navigation-compat";
import { clientEditionCapabilities } from "@/lib/edition";

type HealthPayload = {
  ok: boolean;
  checks?: {
    controlPlane?: {
      ok: boolean;
      detail?: string;
    };
  };
};

export function SelfhostControlPlaneGate() {
  const pathname = usePathname();
  const [controlPlaneHealthy, setControlPlaneHealthy] = useState(true);
  const [detail, setDetail] = useState("Cloud control plane is unavailable.");
  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!clientEditionCapabilities.requiresCloudControlPlane) {
      return;
    }

    let active = true;

    const checkHealth = async () => {
      try {
        const response = await fetch("/api/instance/health", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const payload = (await response.json()) as HealthPayload;
        if (!active) {
          return;
        }

        const ok = Boolean(payload.ok && payload.checks?.controlPlane?.ok);
        setControlPlaneHealthy(ok);
        setDetail(payload.checks?.controlPlane?.detail ?? "Cloud control plane is unavailable.");
      } catch (error) {
        if (!active) {
          return;
        }
        setControlPlaneHealthy(false);
        setDetail(error instanceof Error ? error.message : "Cloud control plane is unavailable.");
      }
    };

    void checkHealth();
    const interval = window.setInterval(() => {
      void checkHealth();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (
    !clientEditionCapabilities.requiresCloudControlPlane ||
    controlPlaneHealthy ||
    pathname?.startsWith("/instance")
  ) {
    return null;
  }

  return (
    <div className="bg-background/95 fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-xl dark:bg-neutral-950">
        <h2 className="text-lg font-semibold">Cloud control plane unavailable</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          This self-hosted deployment depends on the CmdClaw cloud control plane for account links,
          provider auth, and runtime credentials.
        </p>
        <p className="text-muted-foreground mt-3 text-sm">{detail}</p>
        <div className="mt-4 flex gap-3">
          <AppLink
            href="/instance"
            className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Open instance status
          </AppLink>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
