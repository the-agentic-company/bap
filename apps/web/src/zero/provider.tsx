import { Zero } from "@rocicorp/zero";
import { ZeroContext, ZeroProvider } from "@rocicorp/zero/react";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { SessionPrincipal } from "@/lib/route-guards";
import { useCurrentUser } from "@/orpc/hooks/user";
import { env } from "@/env";
import { resolveZeroCacheURL, resolveZeroQueryURL, type BrowserLocation } from "./provider-urls";
import { schema } from "./schema";
import { buildZeroStorageKey } from "./storage-key";

type BapZeroProviderProps = {
  children: ReactNode;
  hasSession: boolean;
  principal?: SessionPrincipal | null;
};

type BapZeroRuntime = {
  error: Error | null;
  isReady: boolean;
  isResolvingWorkspace: boolean;
  userId: string | null;
  workspaceId: string;
};

const BapZeroRuntimeContext = createContext<BapZeroRuntime>({
  error: null,
  isReady: false,
  isResolvingWorkspace: false,
  userId: null,
  workspaceId: "",
});

const DISABLED_SERVER_ZERO = { clientID: "bap-ssr-disabled-zero" } as never;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Failed to initialize Zero workspace context");
}

function getBrowserLocation(): BrowserLocation | undefined {
  return typeof window === "undefined" ? undefined : window.location;
}

function getZeroCacheURL(): string | undefined {
  return resolveZeroCacheURL(env.VITE_ZERO_CACHE_URL, getBrowserLocation());
}

function getZeroQueryURL(): string | undefined {
  return resolveZeroQueryURL(env.VITE_ZERO_QUERY_URL, getBrowserLocation());
}

export function useBapZeroRuntime(): BapZeroRuntime {
  return useContext(BapZeroRuntimeContext);
}

export function BapZeroProvider({ children, hasSession, principal = null }: BapZeroProviderProps) {
  const userId = hasSession ? (principal?.userId ?? null) : null;
  const principalWorkspaceId = hasSession ? (principal?.activeWorkspaceId ?? "") : "";
  const currentUser = useCurrentUser({ enabled: Boolean(userId && !principalWorkspaceId) });
  const workspaceId = principalWorkspaceId || currentUser.data?.activeWorkspaceId || "";
  const isResolvingWorkspace = Boolean(userId && !workspaceId) && currentUser.isPending;
  const error = currentUser.isError ? toError(currentUser.error) : null;
  const canCreateZero = typeof window !== "undefined" && Boolean(userId && workspaceId && !error);
  const cacheURL = getZeroCacheURL();
  const queryURL = getZeroQueryURL();
  const zeroContext = useMemo(() => ({ userId: userId ?? "", workspaceId }), [userId, workspaceId]);
  const storageKey =
    userId && workspaceId
      ? buildZeroStorageKey({
          userId,
          workspaceId,
        })
      : "bap-web:anonymous";
  const zero = useMemo(
    () =>
      canCreateZero
        ? new Zero({
            cacheURL,
            context: zeroContext,
            logLevel: "error",
            queryURL,
            schema,
            storageKey,
            userID: userId,
          })
        : null,
    [cacheURL, canCreateZero, queryURL, storageKey, userId, zeroContext],
  );
  useEffect(
    () => () => {
      void zero?.close();
    },
    [zero],
  );
  const isReady = Boolean(userId && workspaceId && !error && zero);
  const runtime = useMemo(
    () => ({ error, isReady, isResolvingWorkspace, userId, workspaceId }),
    [error, isReady, isResolvingWorkspace, userId, workspaceId],
  );

  if (!zero) {
    return (
      <BapZeroRuntimeContext.Provider value={runtime}>
        <ZeroContext.Provider value={DISABLED_SERVER_ZERO}>{children}</ZeroContext.Provider>
      </BapZeroRuntimeContext.Provider>
    );
  }

  return (
    <BapZeroRuntimeContext.Provider value={runtime}>
      <ZeroProvider zero={zero}>{children}</ZeroProvider>
    </BapZeroRuntimeContext.Provider>
  );
}
