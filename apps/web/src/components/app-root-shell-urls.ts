import { env } from "@/env";

export function getAutumnBetterAuthUrl() {
  return env.VITE_APP_URL ?? (typeof window === "undefined" ? "" : window.location.origin);
}
