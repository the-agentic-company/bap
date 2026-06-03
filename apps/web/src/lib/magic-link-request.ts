export const MAGIC_LINK_TTL_SECONDS = 60 * 60;
export const MAGIC_LINK_TTL_MS = MAGIC_LINK_TTL_SECONDS * 1000;
export const MAGIC_LINK_STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type MagicLinkRedirectState = {
  callbackURL?: string;
  newUserCallbackURL?: string;
  errorCallbackURL?: string;
};

function normalizeState(state: MagicLinkRedirectState): MagicLinkRedirectState {
  return {
    ...(state.callbackURL ? { callbackURL: state.callbackURL } : {}),
    ...(state.newUserCallbackURL ? { newUserCallbackURL: state.newUserCallbackURL } : {}),
    ...(state.errorCallbackURL ? { errorCallbackURL: state.errorCallbackURL } : {}),
  };
}

export function extractMagicLinkRedirectState(verificationUrl: string): MagicLinkRedirectState {
  const parsedUrl = new URL(verificationUrl);

  return normalizeState({
    callbackURL: parsedUrl.searchParams.get("callbackURL") ?? undefined,
    newUserCallbackURL: parsedUrl.searchParams.get("newUserCallbackURL") ?? undefined,
    errorCallbackURL: parsedUrl.searchParams.get("errorCallbackURL") ?? undefined,
  });
}

export function buildSignInMagicLinkUrl({
  token,
  baseUrl,
}: {
  token: string;
  baseUrl: string;
}): string {
  return new URL(buildSignInMagicLinkPath(token), baseUrl).toString();
}

export function buildSignInMagicLinkPath(token: string): string {
  return `/sign-in/${encodeURIComponent(token)}`;
}
