import { INVITE_ONLY_LOGIN_ERROR } from "@/lib/admin-emails";

export const INVITE_ONLY_IMPERSONATION_ERROR_MESSAGE =
  'Turn on "Login Approved" before impersonating this user. They need login access before you can open the app as them.';

type AuthClientErrorLike =
  | {
      code?: string | null;
      message?: string | null;
    }
  | null
  | undefined;

export function getImpersonationErrorMessage(error: AuthClientErrorLike): string {
  if (error?.code === INVITE_ONLY_LOGIN_ERROR || error?.message === INVITE_ONLY_LOGIN_ERROR) {
    return INVITE_ONLY_IMPERSONATION_ERROR_MESSAGE;
  }

  if (typeof error?.message === "string" && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return "Unable to impersonate.";
}
