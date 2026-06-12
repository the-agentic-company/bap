export function resolveCmdclawAppUrl(): string {
  const appUrl =
    process.env.APP_SERVER_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.VITE_APP_URL?.trim();
  if (!appUrl) {
    throw new Error("APP_SERVER_URL or APP_URL must be configured for apps/mcp.");
  }
  return appUrl;
}

export function requireServerSecret(): string {
  const secret = process.env.APP_SERVER_SECRET?.trim();
  if (!secret) {
    throw new Error("APP_SERVER_SECRET must be configured for apps/mcp.");
  }
  return secret;
}
