const APP_AUTH_PROXY_EXACT_PATHS = new Set([
  "/login",
  "/invite-only",
  "/reset-password",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/site.webmanifest",
  "/logo.png",
  "/sw.js",
]);

const APP_AUTH_PROXY_PREFIXES = [
  "/api/auth/",
  "/api/dev/",
  "/assets/",
  "/sign-in/",
  "/reset-password/",
];

export function shouldProxyAppAuthFlowPath(pathname: string): boolean {
  return (
    APP_AUTH_PROXY_EXACT_PATHS.has(pathname) ||
    APP_AUTH_PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
