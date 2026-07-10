import { isSelfHostedEdition } from "@bap/core/server/edition";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getRequestSession } from "@/server/session-auth";
import { resolveSessionPrincipalWorkspaceId } from "@/server/session-principal-workspace";
import { isWorktreeAutoLoginConfigured } from "@/lib/worktree-auto-login";

/**
 * Reusable route-guard helpers for TanStack Router `beforeLoad`.
 *
 * These cover the three access levels the migration spec calls out:
 * - protected session routes (any signed-in user),
 * - support-admin / cloud routes (cloud edition + admin role),
 * - self-host instance routes (self-host edition only).
 *
 * Guards run server-side via a server function that reads the Better Auth session from
 * the request cookies. They are deliberately NOT API authorization: oRPC and API handlers
 * keep enforcing their own auth. Page guards only decide what to render / where to redirect.
 *
 * Areas USE these in their route `beforeLoad`; this module does not migrate any page.
 */

export interface SessionPrincipal {
  userId: string;
  activeWorkspaceId: string;
  email: string;
  image: string | null;
  name: string | null;
  role: string | null;
}

export interface SessionContext {
  principal: SessionPrincipal | null;
  edition: "cloud" | "selfhost";
  isAdmin: boolean;
  worktreeAutoLoginConfigured: boolean;
}

/**
 * Server function that resolves the current request's session principal and environment
 * flags. Reads cookies from the active request, so it must run on the server (SSR or a
 * client navigation that round-trips to the server function endpoint).
 */
export const fetchSessionContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionContext> => {
    const request = getRequest();
    const selfHost = isSelfHostedEdition();
    const sessionData = await getRequestSession(request.headers);

    const user = sessionData?.user ?? null;
    const session = sessionData?.session ?? null;
    const activeWorkspaceId =
      user && session
        ? await resolveSessionPrincipalWorkspaceId(
            user.id,
            (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
          )
        : null;
    const principal: SessionPrincipal | null =
      user && session
        ? {
            userId: user.id,
            activeWorkspaceId: activeWorkspaceId ?? "",
            email: user.email,
            image: user.image ?? null,
            name: user.name ?? null,
            role: (user as { role?: string | null }).role ?? null,
          }
        : null;

    return {
      principal,
      edition: selfHost ? "selfhost" : "cloud",
      isAdmin: principal?.role === "admin",
      worktreeAutoLoginConfigured: isWorktreeAutoLoginConfigured(),
    };
  },
);

function buildLoginRedirect(callbackUrl: string): never {
  // Use the raw-URL escape hatch (`href`) rather than typed `to`, because guards target
  // public auth pages and dynamic callback URLs; this keeps guards decoupled from the
  // typed route tree as page areas are migrated independently.
  throw redirect({
    href: `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
  });
}

function buildWorktreeAutoLoginRedirect(callbackUrl: string): never {
  // Mirror the old proxy behavior: when a local worktree auto-login is configured, send
  // unauthenticated users through the worktree auth endpoint instead of the login page.
  throw redirect({
    href: `/api/dev/worktree-auth?callbackUrl=${encodeURIComponent(callbackUrl)}`,
  });
}

/**
 * Require any signed-in session. Unauthenticated requests are redirected to login with a
 * `callbackUrl` so the original destination is restored after sign-in (or routed through
 * worktree auto-login when configured for local development).
 */
export async function requireSession(callbackUrl: string): Promise<SessionContext> {
  const context = await fetchSessionContext();
  if (context.principal) {
    return context;
  }

  if (context.worktreeAutoLoginConfigured) {
    buildWorktreeAutoLoginRedirect(callbackUrl);
  }

  buildLoginRedirect(callbackUrl);
}

/**
 * Require a cloud-edition support admin. Non-admins (or self-host) are redirected home so
 * admin surfaces are never merely client-side protected. API authorization is enforced
 * separately inside the admin handlers.
 */
export async function requireSupportAdmin(callbackUrl: string): Promise<SessionContext> {
  const context = await requireSession(callbackUrl);

  if (context.edition !== "cloud" || !context.isAdmin) {
    throw redirect({ href: "/" });
  }

  return context;
}

/**
 * Require the self-host edition for instance-administration routes. In the cloud edition
 * these routes do not exist, so redirect home.
 */
export async function requireSelfHostInstance(callbackUrl: string): Promise<SessionContext> {
  const context = await fetchSessionContext();

  if (context.edition !== "selfhost") {
    throw redirect({ href: "/" });
  }

  if (!context.principal) {
    buildLoginRedirect(callbackUrl);
  }

  return context;
}
