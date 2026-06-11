import { auth } from "@/lib/auth";

export async function getRequestSession(headers: Headers) {
  return auth.api.getSession({ headers }).catch(() => null);
}
