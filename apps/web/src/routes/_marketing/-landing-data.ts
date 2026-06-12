import type { TemplateCatalogTemplate } from "@cmdclaw/db/template-catalog";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth";
import {
  buildWorktreeAutoLoginPath,
  isWorktreeAutoLoginConfigured,
} from "@/lib/worktree-auto-login";
import { listFeaturedTemplateCatalogEntries } from "@/server/services/template-catalog";

/**
 * Server-side data for the landing route (`/`).
 *
 * Migrated from the previous `src/app/page.tsx` server component. It resolves the Better Auth
 * session from the request cookies, replicates the worktree auto-login redirect for
 * unauthenticated local-dev requests, and loads the featured template catalog used by the
 * landing hero. Runs as a TanStack server function so the same logic executes on SSR and on
 * client navigations to `/`.
 *
 * Returned shape feeds `CoworkerLanding`'s `initialHasSession` / `initialFirstName` /
 * `featuredTemplates` props, matching the old page's contract exactly.
 */
export interface LandingData {
  initialHasSession: boolean;
  initialFirstName: string | null;
  featuredTemplates: TemplateCatalogTemplate[];
}

export const fetchLandingData = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingData> => {
    const request = getRequest();
    const sessionData = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    const hasSession = Boolean(sessionData?.session && sessionData?.user);

    if (!hasSession && isWorktreeAutoLoginConfigured()) {
      // Mirror the old page behavior: in a configured local worktree, send unauthenticated
      // visitors through worktree auto-login instead of rendering the anonymous landing.
      throw redirect({ href: buildWorktreeAutoLoginPath("/", "/") });
    }

    const featuredTemplates = await listFeaturedTemplateCatalogEntries({ limit: 8 });
    const initialFirstName = sessionData?.user?.name?.trim().split(/\s+/, 1).find(Boolean) ?? null;

    return {
      initialHasSession: hasSession,
      initialFirstName,
      featuredTemplates,
    };
  },
);
