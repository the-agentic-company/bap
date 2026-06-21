import { auth } from "@/lib/auth";

const BETTER_AUTH_SESSION_COOKIE_NAMES = new Set([
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
]);
const BETTER_AUTH_SESSION_COOKIE_NAME_ALTERNATES = {
  "better-auth.session_token": "__Secure-better-auth.session_token",
  "__Secure-better-auth.session_token": "better-auth.session_token",
} as const;
const SERVER_SESSION_COOKIE_NAME = "better-auth.session_token";
type RequestSession = Awaited<ReturnType<typeof auth.api.getSession>>;

type CookiePair = {
  name: string;
  value: string;
};

function splitCookiePair(cookie: string): CookiePair | null {
  const separatorIndex = cookie.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  return {
    name: cookie.slice(0, separatorIndex),
    value: cookie.slice(separatorIndex + 1),
  };
}

export function normalizeSessionCookieHeaders(headers: Headers): Headers {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return headers;
  }

  const cookies = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean);
  const passthroughCookies: string[] = [];
  let latestSessionCookie: CookiePair | null = null;

  for (const cookie of cookies) {
    const pair = splitCookiePair(cookie);
    if (!pair) {
      passthroughCookies.push(cookie);
      continue;
    }

    if (BETTER_AUTH_SESSION_COOKIE_NAMES.has(pair.name)) {
      latestSessionCookie = pair;
      continue;
    }

    passthroughCookies.push(cookie);
  }

  if (!latestSessionCookie) {
    return headers;
  }

  const normalizedHeaders = new Headers(headers);
  normalizedHeaders.set(
    "cookie",
    [...passthroughCookies, `${SERVER_SESSION_COOKIE_NAME}=${latestSessionCookie.value}`].join(
      "; ",
    ),
  );
  return normalizedHeaders;
}

export function getSessionCookieHeaders(headers: Headers): Headers[] {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return [];
  }

  const seen = new Set<string>();
  const sessionHeaders: Headers[] = [];

  for (const cookie of cookieHeader
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)
    .toReversed()) {
    const pair = splitCookiePair(cookie);
    if (!pair || !BETTER_AUTH_SESSION_COOKIE_NAMES.has(pair.name)) {
      continue;
    }

    const candidateNames = [
      pair.name,
      BETTER_AUTH_SESSION_COOKIE_NAME_ALTERNATES[
        pair.name as keyof typeof BETTER_AUTH_SESSION_COOKIE_NAME_ALTERNATES
      ],
    ];

    for (const candidateName of candidateNames) {
      const candidateCookie = `${candidateName}=${pair.value}`;
      if (seen.has(candidateCookie)) {
        continue;
      }

      seen.add(candidateCookie);
      const nextHeaders = new Headers(headers);
      nextHeaders.set("cookie", candidateCookie);
      sessionHeaders.push(nextHeaders);
    }
  }

  return sessionHeaders;
}

export async function getRequestSession(headers: Headers) {
  const directSession = await auth.api.getSession({ headers }).catch(() => null);
  if (directSession?.user?.id && directSession?.session) {
    return directSession;
  }

  const candidateHeaders = getSessionCookieHeaders(headers);
  const candidateSessions = await Promise.all(
    candidateHeaders.map((sessionHeaders) =>
      auth.api.getSession({ headers: sessionHeaders }).catch(() => null),
    ),
  );

  return (
    candidateSessions.find((sessionData) => sessionData?.user?.id && sessionData?.session) ?? null
  );
}

export async function getRequestSessionCandidates(headers: Headers) {
  const resolvedSessions = await Promise.all(
    getSessionCookieHeaders(headers).map((sessionHeaders) =>
      auth.api.getSession({ headers: sessionHeaders }).catch(() => null),
    ),
  );

  const sessions: NonNullable<RequestSession>[] = [];
  for (const session of resolvedSessions) {
    if (session?.user?.id && !sessions.some((candidate) => candidate.user.id === session.user.id)) {
      sessions.push(session);
    }
  }
  return sessions;
}
