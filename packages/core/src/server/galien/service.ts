import { db } from "@bap/db/client";
import { galienCredential, galienWorkspaceAccess, user, workspaceMember } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "../utils/encryption";

const GALIEN_API_BASE_URLS = {
  prod: "https://api.frontline.galien.webhelpmedica.com",
  preprod: "https://api.frontline.galien.preprod.webhelpmedica.com",
} as const;
const GALIEN_LOGIN_PATH = "/api/v1/tokens/login";

type DatabaseLike = typeof db;
export type GalienTargetEnv = keyof typeof GALIEN_API_BASE_URLS;
export const DEFAULT_GALIEN_TARGET_ENV: GalienTargetEnv = "prod";

export type GalienCurrentUser = {
  id: number;
  role?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  iat?: number;
  exp?: number;
};

export type DecryptedGalienCredential = {
  username: string;
  password: string;
  targetEnv: GalienTargetEnv;
  apiBaseUrl: string;
  displayName: string | null;
  galienUserId: number | null;
};

export class GalienCredentialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GalienCredentialValidationError";
  }
}

export function normalizeGalienAccessEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseGalienTargetEnv(value: unknown): GalienTargetEnv {
  return value === "preprod" ? "preprod" : DEFAULT_GALIEN_TARGET_ENV;
}

export function getGalienApiBaseUrl(targetEnv: GalienTargetEnv): string {
  return GALIEN_API_BASE_URLS[targetEnv];
}

function decodeJwtPayload(bearerToken: string) {
  const token = bearerToken.replace(/^Bearer\s+/i, "");
  const [, payload] = token.split(".");
  if (!payload) {
    throw new GalienCredentialValidationError(
      "Galien login returned a bearer token that is not a JWT.",
    );
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new GalienCredentialValidationError(
      "Galien login returned a JWT with an unreadable payload.",
    );
  }
}

export function decodeGalienCurrentUserFromBearerToken(bearerToken: string): GalienCurrentUser {
  const payload = decodeJwtPayload(bearerToken);
  const rawId = payload.id;
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;

  if (!Number.isInteger(id)) {
    throw new GalienCredentialValidationError(
      "Galien login JWT did not include a valid numeric user id claim.",
    );
  }

  return {
    id,
    role: typeof payload.role === "string" ? payload.role : undefined,
    firstName: typeof payload.firstName === "string" ? payload.firstName : undefined,
    lastName: typeof payload.lastName === "string" ? payload.lastName : undefined,
    username: typeof payload.username === "string" ? payload.username : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

async function parseGalienErrorBody(response: Response) {
  try {
    const body = await response.text();
    return body.trim();
  } catch {
    return "";
  }
}

async function loginToGalienWithCredentials(input: {
  username: string;
  password: string;
  targetEnv: GalienTargetEnv;
}): Promise<string> {
  const username = input.username.trim();
  const password = input.password.trim();
  if (!username || !password) {
    throw new GalienCredentialValidationError("Galien username and password are required.");
  }

  let response: Response;
  try {
    response = await fetch(new URL(GALIEN_LOGIN_PATH, getGalienApiBaseUrl(input.targetEnv)), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });
  } catch (error) {
    throw new GalienCredentialValidationError(
      `Galien login request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const body = await parseGalienErrorBody(response);
    throw new GalienCredentialValidationError(
      `Galien login failed (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`,
    );
  }

  const authorization = response.headers.get("authorization")?.trim();
  if (authorization?.startsWith("Bearer ")) {
    return authorization;
  }

  throw new GalienCredentialValidationError(
    "Galien login succeeded but did not return a bearer token.",
  );
}

export async function validateGalienCredentials(input: {
  username: string;
  password: string;
  targetEnv?: GalienTargetEnv;
}): Promise<GalienCurrentUser> {
  const bearerToken = await loginToGalienWithCredentials({
    ...input,
    targetEnv: input.targetEnv ?? DEFAULT_GALIEN_TARGET_ENV,
  });
  return decodeGalienCurrentUserFromBearerToken(bearerToken);
}

function formatGalienDisplayName(currentUser: GalienCurrentUser): string | null {
  const name = [currentUser.firstName, currentUser.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || currentUser.username || null;
}

export async function getGalienWorkspaceAccessForUser(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}) {
  const database = input.database ?? db;
  const membership = await database.query.workspaceMember.findFirst({
    where: and(
      eq(workspaceMember.userId, input.userId),
      eq(workspaceMember.organizationId, input.workspaceId),
    ),
    with: {
      user: {
        columns: {
          email: true,
        },
      },
    },
  });

  const normalizedEmail = membership?.user?.email
    ? normalizeGalienAccessEmail(membership.user.email)
    : "";
  if (!normalizedEmail) {
    return null;
  }

  const access = await database.query.galienWorkspaceAccess.findFirst({
    where: and(
      eq(galienWorkspaceAccess.workspaceId, input.workspaceId),
      eq(galienWorkspaceAccess.email, normalizedEmail),
    ),
  });

  return access
    ? {
        ...access,
        targetEnv: parseGalienTargetEnv(access.targetEnv),
      }
    : null;
}

export async function canUserUseGalienInWorkspace(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  return Boolean(await getGalienWorkspaceAccessForUser(input));
}

export async function listGalienWorkspaceAccess(input: {
  database?: DatabaseLike;
  workspaceId: string;
}) {
  const database = input.database ?? db;
  return database.query.galienWorkspaceAccess.findMany({
    where: eq(galienWorkspaceAccess.workspaceId, input.workspaceId),
    orderBy: (entry, { asc }) => [asc(entry.email), asc(entry.createdAt)],
  });
}

export async function addGalienWorkspaceAccess(input: {
  database?: DatabaseLike;
  workspaceId: string;
  email: string;
  targetEnv?: GalienTargetEnv;
  createdByUserId: string;
}) {
  const database = input.database ?? db;
  const email = normalizeGalienAccessEmail(input.email);
  if (!email) {
    throw new Error("Email is required.");
  }

  const [entry] = await database
    .insert(galienWorkspaceAccess)
    .values({
      workspaceId: input.workspaceId,
      email,
      targetEnv: input.targetEnv ?? DEFAULT_GALIEN_TARGET_ENV,
      createdByUserId: input.createdByUserId,
    })
    .onConflictDoUpdate({
      target: [galienWorkspaceAccess.workspaceId, galienWorkspaceAccess.email],
      set: {
        createdByUserId: input.createdByUserId,
        targetEnv: input.targetEnv ?? DEFAULT_GALIEN_TARGET_ENV,
      },
    })
    .returning();

  return entry;
}

export async function updateGalienWorkspaceAccessTargetEnv(input: {
  database?: DatabaseLike;
  id: string;
  targetEnv: GalienTargetEnv;
}) {
  const database = input.database ?? db;
  const [entry] = await database
    .update(galienWorkspaceAccess)
    .set({ targetEnv: input.targetEnv })
    .where(eq(galienWorkspaceAccess.id, input.id))
    .returning();
  return entry
    ? {
        ...entry,
        targetEnv: parseGalienTargetEnv(entry.targetEnv),
      }
    : null;
}

export async function removeGalienWorkspaceAccess(input: { database?: DatabaseLike; id: string }) {
  const database = input.database ?? db;
  const [entry] = await database
    .delete(galienWorkspaceAccess)
    .where(eq(galienWorkspaceAccess.id, input.id))
    .returning();
  return entry ?? null;
}

export async function getGalienCredentialStatus(input: {
  database?: DatabaseLike;
  userId: string;
  targetEnv: GalienTargetEnv;
}) {
  const database = input.database ?? db;
  const credential = await database.query.galienCredential.findFirst({
    where: and(
      eq(galienCredential.userId, input.userId),
      eq(galienCredential.targetEnv, input.targetEnv),
    ),
    columns: {
      id: true,
      targetEnv: true,
      displayName: true,
      galienUserId: true,
      validatedAt: true,
      updatedAt: true,
    },
  });

  return credential
    ? {
        connected: true,
        targetEnv: parseGalienTargetEnv(credential.targetEnv),
        apiBaseUrl: getGalienApiBaseUrl(parseGalienTargetEnv(credential.targetEnv)),
        displayName: credential.displayName,
        galienUserId: credential.galienUserId,
        validatedAt: credential.validatedAt,
        updatedAt: credential.updatedAt,
      }
    : {
        connected: false,
        targetEnv: input.targetEnv,
        apiBaseUrl: getGalienApiBaseUrl(input.targetEnv),
        displayName: null,
        galienUserId: null,
        validatedAt: null,
        updatedAt: null,
      };
}

export async function setGalienCredential(input: {
  database?: DatabaseLike;
  userId: string;
  targetEnv: GalienTargetEnv;
  username: string;
  password: string;
}) {
  const database = input.database ?? db;
  const username = input.username.trim();
  const password = input.password.trim();
  const currentUser = await validateGalienCredentials({
    username,
    password,
    targetEnv: input.targetEnv,
  });
  const displayName = formatGalienDisplayName(currentUser);
  const now = new Date();

  const [credential] = await database
    .insert(galienCredential)
    .values({
      userId: input.userId,
      targetEnv: input.targetEnv,
      username: encrypt(username),
      password: encrypt(password),
      galienUserId: currentUser.id,
      displayName,
      validatedAt: now,
    })
    .onConflictDoUpdate({
      target: [galienCredential.userId, galienCredential.targetEnv],
      set: {
        username: encrypt(username),
        password: encrypt(password),
        galienUserId: currentUser.id,
        displayName,
        validatedAt: now,
        updatedAt: now,
      },
    })
    .returning({
      targetEnv: galienCredential.targetEnv,
      displayName: galienCredential.displayName,
      galienUserId: galienCredential.galienUserId,
      validatedAt: galienCredential.validatedAt,
      updatedAt: galienCredential.updatedAt,
    });

  return credential;
}

export async function deleteGalienCredential(input: {
  database?: DatabaseLike;
  userId: string;
  targetEnv: GalienTargetEnv;
}) {
  const database = input.database ?? db;
  await database
    .delete(galienCredential)
    .where(
      and(
        eq(galienCredential.userId, input.userId),
        eq(galienCredential.targetEnv, input.targetEnv),
      ),
    );
}

export async function getGalienCredentialForUser(input: {
  database?: DatabaseLike;
  userId: string;
  targetEnv: GalienTargetEnv;
}): Promise<DecryptedGalienCredential | null> {
  const database = input.database ?? db;
  const credential = await database.query.galienCredential.findFirst({
    where: and(
      eq(galienCredential.userId, input.userId),
      eq(galienCredential.targetEnv, input.targetEnv),
    ),
  });

  if (!credential) {
    return null;
  }

  return {
    username: decrypt(credential.username),
    password: decrypt(credential.password),
    targetEnv: parseGalienTargetEnv(credential.targetEnv),
    apiBaseUrl: getGalienApiBaseUrl(parseGalienTargetEnv(credential.targetEnv)),
    displayName: credential.displayName,
    galienUserId: credential.galienUserId,
  };
}

export async function getGalienAccessStatus(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}) {
  const access = await getGalienWorkspaceAccessForUser(input);
  const targetEnv = access?.targetEnv ?? DEFAULT_GALIEN_TARGET_ENV;
  const credential = await getGalienCredentialStatus({
    database: input.database,
    userId: input.userId,
    targetEnv,
  });

  return {
    allowed: Boolean(access),
    accessId: access?.id ?? null,
    ...credential,
  };
}
