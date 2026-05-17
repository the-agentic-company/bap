import { shouldGrantAdminRole } from "@/lib/admin-emails";
import { auth } from "@/lib/auth";
import { normalizeApprovedLoginEmail } from "@/server/lib/approved-login-emails";

type AuthUserRecord = {
  id: string;
  email: string;
  name?: string | null;
};

function unwrapAuthUser(
  value:
    | AuthUserRecord
    | {
        user?: AuthUserRecord;
      }
    | null
    | undefined,
): AuthUserRecord | null {
  if (!value) {
    return null;
  }

  if ("user" in value && value.user) {
    return value.user;
  }

  if ("id" in value && "email" in value) {
    return value;
  }

  return null;
}

function defaultCredentialUserName(email: string): string {
  const localPart = email.split("@")[0] ?? "CmdClaw User";
  const normalized = localPart.replace(/[._+-]+/g, " ").trim();
  if (!normalized) {
    return "CmdClaw User";
  }

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export async function findAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const authContext = await auth.$context;
  const normalizedEmail = normalizeApprovedLoginEmail(email);
  return unwrapAuthUser(await authContext.internalAdapter.findUserByEmail(normalizedEmail));
}

export async function findAuthUserById(userId: string): Promise<AuthUserRecord | null> {
  const authContext = await auth.$context;
  return unwrapAuthUser(await authContext.internalAdapter.findUserById(userId));
}

export async function resolveOrCreateAuthUserByEmail(params: {
  email: string;
  name?: string | null;
}): Promise<AuthUserRecord> {
  const authContext = await auth.$context;
  const normalizedEmail = normalizeApprovedLoginEmail(params.email);
  const existingUser = await findAuthUserByEmail(normalizedEmail);

  if (existingUser) {
    return existingUser;
  }

  const fallbackName = params.name?.trim() || defaultCredentialUserName(normalizedEmail);
  const createdUser = await authContext.internalAdapter.createUser({
    email: normalizedEmail,
    emailVerified: false,
    name: fallbackName,
    role: shouldGrantAdminRole(normalizedEmail) ? "admin" : "user",
  });

  return {
    id: createdUser.id,
    email: createdUser.email,
    name: createdUser.name,
  };
}

export async function setCredentialPassword(input: { userId: string; password: string }) {
  const authContext = await auth.$context;
  const hashedPassword = await authContext.password.hash(input.password);
  const existingAccounts = await authContext.internalAdapter.findAccounts(input.userId);
  const credentialAccount = existingAccounts?.find(
    (account) => account.providerId === "credential",
  );

  if (credentialAccount) {
    await authContext.internalAdapter.updatePassword(input.userId, hashedPassword);
  } else {
    await authContext.internalAdapter.linkAccount({
      accountId: input.userId,
      providerId: "credential",
      password: hashedPassword,
      userId: input.userId,
    });
  }

  await authContext.internalAdapter.deleteSessions(input.userId);
}

export async function hasCredentialPasswordByEmail(email: string): Promise<boolean> {
  const authContext = await auth.$context;
  const existingUser = await findAuthUserByEmail(email);

  if (!existingUser) {
    return false;
  }

  const existingAccounts = await authContext.internalAdapter.findAccounts(existingUser.id);
  return (
    existingAccounts?.some(
      (account) => account.providerId === "credential" && Boolean(account.password),
    ) ?? false
  );
}
