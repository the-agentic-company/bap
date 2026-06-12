import {
  SUBSCRIPTION_PROVIDERS,
  isOAuthProviderConfig,
  type SubscriptionProviderID,
} from "@cmdclaw/core/server/ai/subscription-providers";
import { z } from "zod";
import { env } from "@/env";
import { INVITE_ONLY_LOGIN_ERROR } from "@/lib/admin-emails";
import { auth } from "@/lib/auth";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";
import { consumePending } from "@/server/ai/pending-oauth";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";
import {
  isApprovedLoginEmail,
  normalizeApprovedLoginEmail,
} from "@/server/lib/approved-login-emails";
import {
  hasCredentialPasswordByEmail,
  resolveOrCreateAuthUserByEmail,
} from "@/server/lib/credential-accounts";
import {
  markMagicLinkRequestConsumed,
  resolveMagicLinkPageState,
} from "@/server/lib/magic-link-request-state";
import { storeProviderTokens } from "@/server/orpc/routers/provider-auth";
import { getTrustedOrigins } from "@/lib/trusted-origins";

/**
 * Framework-neutral HTTP handlers for the `/api/auth/**` URL area.
 *
 * These use only standard Request/Response/Headers/URL so the TanStack Start
 * server route files stay thin adapters and the logic stays testable without
 * the framework. API authorization lives here in the handlers, not in any page
 * route guard.
 *
 * Better Auth keeps owning the catch-all `/api/auth/**` surface; we call
 * `auth.handler(request)` directly and the `tanstackStartCookies` plugin writes Set-Cookie
 * headers.
 */

const trustedOrigins = new Set(getTrustedOrigins());

const DEFAULT_ALLOWED_ORIGIN =
  env.APP_URL ?? env.VITE_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && trustedOrigins.has(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : DEFAULT_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

async function readInviteOnlyError(
  response: Response,
): Promise<{ matched: boolean; email?: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { matched: false };
  }

  try {
    const body = (await response.clone().json()) as {
      code?: string;
      message?: string;
      email?: string;
    };
    const matched =
      body.code === INVITE_ONLY_LOGIN_ERROR || body.message === INVITE_ONLY_LOGIN_ERROR;
    return { matched, email: typeof body.email === "string" ? body.email : undefined };
  } catch {
    return { matched: false };
  }
}

async function redirectInviteOnlyAuthError(
  request: Request,
  response: Response,
): Promise<Response | null> {
  const callbackPrefix = "/api/auth/callback/";
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(callbackPrefix)) {
    return null;
  }

  const { matched, email } = await readInviteOnlyError(response);
  if (!matched) {
    return null;
  }

  const provider = pathname.slice(callbackPrefix.length);
  const inviteOnlyUrl = buildRequestAwareUrl("/invite-only", request);
  inviteOnlyUrl.searchParams.set("source", provider ? `social-${provider}` : "social");
  if (email) {
    inviteOnlyUrl.searchParams.set("email", email);
  }
  return Response.redirect(inviteOnlyUrl, 307);
}

/**
 * Re-applies CORS headers and the invite-only social-callback redirect onto the
 * Better Auth response while preserving every Set-Cookie header. Cloning into a
 * fresh Response can drop multi-value Set-Cookie headers, so we re-apply them
 * explicitly via `getSetCookie()`.
 */
function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const newResponse = new Response(response.body, response);

  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Headers.delete, not a Drizzle query
    newResponse.headers.delete("set-cookie");
    for (const cookie of setCookies) {
      newResponse.headers.append("set-cookie", cookie);
    }
  }

  for (const [key, value] of Object.entries(corsHeaders)) {
    newResponse.headers.set(key, value);
  }

  return newResponse;
}

/**
 * Better Auth catch-all handler (`/api/auth/**`). Delegates to
 * `auth.handler(request)`, applies the invite-only social-callback redirect,
 * and re-applies CORS + Set-Cookie headers. Used for every HTTP method.
 */
export async function handleBetterAuth(request: Request): Promise<Response> {
  const handled = await auth.handler(request);
  const response = (await redirectInviteOnlyAuthError(request, handled)) ?? handled;
  return withCors(request, response);
}

/**
 * CORS preflight for the Better Auth surface.
 */
export function handleBetterAuthOptions(request: Request): Response {
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

function buildSignInTokenRedirect(request: Request, token: string): URL {
  return buildRequestAwareUrl(`/sign-in/${encodeURIComponent(token)}`, request);
}

const BETTER_AUTH_MAGIC_LINK_ERRORS = new Set([
  "INVALID_TOKEN",
  "EXPIRED_TOKEN",
  "failed_to_create_user",
  "new_user_signup_disabled",
  "failed_to_create_session",
]);

function isSuccessfulMagicLinkVerifyResponse(response: Response): boolean {
  const location = response.headers.get("location");
  if (!location) {
    return response.ok;
  }

  const decodedLocation = decodeURIComponent(location);
  for (const error of BETTER_AUTH_MAGIC_LINK_ERRORS) {
    if (decodedLocation.includes(`error=${error}`)) {
      return false;
    }
  }

  try {
    const redirectUrl = new URL(location);
    const error = redirectUrl.searchParams.get("error");
    return !error || !BETTER_AUTH_MAGIC_LINK_ERRORS.has(error);
  } catch {
    return !location.includes("error=");
  }
}

function withMagicLinkRedirectParams(
  url: URL,
  request: Request,
  state: Extract<Awaited<ReturnType<typeof resolveMagicLinkPageState>>, { email: string }>,
) {
  url.searchParams.set(
    "callbackURL",
    buildRequestAwareUrl(state.callbackUrl ?? "/", request).toString(),
  );
  if (state.newUserCallbackUrl) {
    url.searchParams.set(
      "newUserCallbackURL",
      buildRequestAwareUrl(state.newUserCallbackUrl, request).toString(),
    );
  }
  if (state.errorCallbackUrl) {
    url.searchParams.set(
      "errorCallbackURL",
      buildRequestAwareUrl(state.errorCallbackUrl, request).toString(),
    );
  }
}

/**
 * POST `/sign-in/:token/confirm` — explicit confirmation step for CmdClaw magic links.
 *
 * The public email link lands on a first-party confirmation page. This handler delegates
 * verification/session-cookie work to Better Auth's existing magic-link endpoint, then marks
 * CmdClaw's page-state row consumed only after Better Auth accepts the token.
 */
export async function handleMagicLinkConfirm(request: Request, token: string): Promise<Response> {
  const state = await resolveMagicLinkPageState(token);
  const signInUrl = buildSignInTokenRedirect(request, token);

  if (state.status !== "pending") {
    signInUrl.searchParams.set("error", state.status);
    return Response.redirect(signInUrl, 303);
  }

  const verifyUrl = buildRequestAwareUrl("/api/auth/magic-link/verify", request);
  verifyUrl.searchParams.set("token", token);
  withMagicLinkRedirectParams(verifyUrl, request, state);

  const response = await handleBetterAuth(
    new Request(verifyUrl, {
      method: "GET",
      headers: request.headers,
    }),
  );

  if (isSuccessfulMagicLinkVerifyResponse(response)) {
    await markMagicLinkRequestConsumed(token);
  }

  return response;
}

/**
 * POST `/sign-in/:token/resend` — request a replacement magic link for expired/used links.
 */
export async function handleMagicLinkResend(request: Request, token: string): Promise<Response> {
  const state = await resolveMagicLinkPageState(token);
  const signInUrl = buildSignInTokenRedirect(request, token);

  if (state.status === "invalid") {
    signInUrl.searchParams.set("error", "invalid");
    return Response.redirect(signInUrl, 303);
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  const signInRequestUrl = buildRequestAwareUrl("/api/auth/sign-in/magic-link", request);
  const response = await handleBetterAuth(
    new Request(signInRequestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: state.email,
        callbackURL: buildRequestAwareUrl(state.callbackUrl ?? "/", request).toString(),
        ...(state.newUserCallbackUrl
          ? {
              newUserCallbackURL: buildRequestAwareUrl(
                state.newUserCallbackUrl,
                request,
              ).toString(),
            }
          : {}),
        ...(state.errorCallbackUrl
          ? {
              errorCallbackURL: buildRequestAwareUrl(state.errorCallbackUrl, request).toString(),
            }
          : {}),
      }),
    }),
  );

  if (!response.ok) {
    signInUrl.searchParams.set("error", "resend_failed");
    return Response.redirect(signInUrl, 303);
  }

  signInUrl.searchParams.set("resent", "1");
  return Response.redirect(signInUrl, 303);
}

const checkEmailSchema = z.object({
  email: z.string().email(),
});

/**
 * `/api/auth/check-email` — reports whether an email is approved for login and
 * whether it already has a credential password set.
 */
export async function handleCheckEmail(request: Request): Promise<Response> {
  const parsedBody = checkEmailSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return Response.json({ approved: false }, { status: 400 });
  }

  const normalizedEmail = normalizeApprovedLoginEmail(parsedBody.data.email);
  const approved = await isApprovedLoginEmail(normalizedEmail);
  const hasPassword = approved ? await hasCredentialPasswordByEmail(normalizedEmail) : false;

  return Response.json({ approved, hasPassword });
}

const passwordStartSchema = z.object({
  email: z.string().email(),
  callbackUrl: z.string().optional(),
});

/**
 * `/api/auth/password/start` — begins the password-reset onboarding flow for an
 * approved email, creating the auth user if needed, then requests a reset email
 * that lands on `/reset-password` with the sanitized callback URL.
 */
export async function handlePasswordStart(request: Request): Promise<Response> {
  const parsedBody = passwordStartSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const normalizedEmail = normalizeApprovedLoginEmail(parsedBody.data.email);
  const callbackUrl = sanitizeReturnPath(parsedBody.data.callbackUrl, "/chat");

  if (!(await isApprovedLoginEmail(normalizedEmail))) {
    return Response.json({ ok: false, code: INVITE_ONLY_LOGIN_ERROR }, { status: 403 });
  }

  await resolveOrCreateAuthUserByEmail({ email: normalizedEmail });

  const redirectTo = buildRequestAwareUrl("/reset-password", request);
  redirectTo.searchParams.set("callbackUrl", callbackUrl);
  redirectTo.searchParams.set("email", normalizedEmail);

  await auth.api.requestPasswordReset({
    body: {
      email: normalizedEmail,
      redirectTo: redirectTo.toString(),
    },
    headers: request.headers,
  });

  return Response.json({ ok: true });
}

/**
 * `/api/auth/native-callback` — native app callback for magic-link auth.
 *
 * Flow:
 * 1. App requests magic link with callbackURL pointing here.
 * 2. User clicks email link, Better Auth verifies and sets session cookies.
 * 3. Better Auth redirects here with cookies set.
 * 4. We extract the session token from cookies and redirect to the native app.
 */
export async function handleNativeCallback(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const redirect = searchParams.get("redirect") || "cmdclaw://auth/callback";

  try {
    const cookieHeader = request.headers.get("cookie");
    console.log("[native-callback] Cookies received:", cookieHeader);

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    console.log("[native-callback] Session result:", JSON.stringify(session, null, 2));

    if (!session?.session?.token) {
      console.error("[native-callback] No session token found");
      const errorUrl = new URL(redirect);
      errorUrl.searchParams.set("error", "no_session");
      return Response.redirect(errorUrl.toString(), 307);
    }

    const callbackUrl = new URL(redirect);
    callbackUrl.searchParams.set("token", session.session.token);

    console.log(`[native-callback] Redirecting to native app with token`);
    return Response.redirect(callbackUrl.toString(), 307);
  } catch (error) {
    console.error("[native-callback] Error:", error);
    const errorUrl = new URL(redirect);
    errorUrl.searchParams.set("error", "verification_failed");
    return Response.redirect(errorUrl.toString(), 307);
  }
}

/**
 * `/api/auth/provider/:provider/callback` — subscription-provider OAuth callback.
 *
 * Exchanges the authorization code for tokens (PKCE or client-secret), verifies
 * the authenticated user matches the pending OAuth request, stores encrypted
 * tokens, and redirects back to `/settings/subscriptions` with a result flag.
 * API authorization (session + pending state ownership) lives here.
 */
export async function handleProviderCallback(
  request: Request,
  provider: string,
): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const settingsUrl = buildRequestAwareUrl("/settings/subscriptions", request);

  if (error) {
    const errorDescription = searchParams.get("error_description");
    console.error(`[ProviderAuth] OAuth error for ${provider}:`, errorDescription || error);
    settingsUrl.searchParams.set("provider_error", error);
    return Response.redirect(settingsUrl, 307);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("provider_error", "missing_params");
    return Response.redirect(settingsUrl, 307);
  }

  if (!(provider in SUBSCRIPTION_PROVIDERS)) {
    settingsUrl.searchParams.set("provider_error", "invalid_provider");
    return Response.redirect(settingsUrl, 307);
  }

  const providerConfig = SUBSCRIPTION_PROVIDERS[provider as SubscriptionProviderID];
  if (!isOAuthProviderConfig(providerConfig)) {
    settingsUrl.searchParams.set("provider_error", "invalid_provider");
    return Response.redirect(settingsUrl, 307);
  }

  const pending = await consumePending(state);
  if (!pending) {
    settingsUrl.searchParams.set("provider_error", "invalid_state");
    return Response.redirect(settingsUrl, 307);
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.id !== pending.userId) {
    settingsUrl.searchParams.set("provider_error", "auth_mismatch");
    return Response.redirect(settingsUrl, 307);
  }

  try {
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: providerConfig.redirectUri,
      client_id: providerConfig.clientId,
    });

    if (pending.codeVerifier) {
      tokenBody.set("code_verifier", pending.codeVerifier);
    }

    if (!providerConfig.usePKCE && providerConfig.clientSecret) {
      tokenBody.set("client_secret", providerConfig.clientSecret);
    }

    const tokenResponse = await fetch(providerConfig.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`[ProviderAuth] Token exchange failed for ${provider}:`, errorText);
      settingsUrl.searchParams.set("provider_error", "token_exchange_failed");
      return Response.redirect(settingsUrl, 307);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : new Date(Date.now() + 3600 * 1000);

    await storeProviderTokens({
      userId: pending.userId,
      provider: provider as SubscriptionProviderID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt,
    });

    settingsUrl.searchParams.set("provider_connected", provider);
    return Response.redirect(settingsUrl, 307);
  } catch (err) {
    console.error(`[ProviderAuth] Callback error for ${provider}:`, err);
    settingsUrl.searchParams.set("provider_error", "callback_failed");
    return Response.redirect(settingsUrl, 307);
  }
}
