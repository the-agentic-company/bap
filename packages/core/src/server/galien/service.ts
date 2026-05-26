import { db } from "@cmdclaw/db/client";
import {
  galienCredential,
  galienWorkspaceAccess,
  user,
  workspaceMember,
} from "@cmdclaw/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "../utils/encryption";

const GALIEN_BASE_URL = "https://api.frontline.galien.preprod.webhelpmedica.com";
const GALIEN_LOGIN_PATH = "/api/v1/tokens/login";

type DatabaseLike = typeof db;

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

function decodeJwtPayload(bearerToken: string) {
  const token = bearerToken.replace(/^Bearer\s+/i, "");
  const [, payload] = token.split(".");
  if (!payload) {
    throw new GalienCredentialValidationError(
      "Galien login returned a bearer token that is not a JWT.",
    );
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
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
}): Promise<string> {
  const username = input.username.trim();
  const password = input.password.trim();
  if (!username || !password) {
    throw new GalienCredentialValidationError("Galien username and password are required.");
  }

  let response: Response;
  try {
    response = await fetch(new URL(GALIEN_LOGIN_PATH, GALIEN_BASE_URL), {
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
}): Promise<GalienCurrentUser> {
  const bearerToken = await loginToGalienWithCredentials(input);
  return decodeGalienCurrentUserFromBearerToken(bearerToken);
}

function formatGalienDisplayName(currentUser: GalienCurrentUser): string | null {
  const name = [currentUser.firstName, currentUser.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || currentUser.username || null;
}

export async function canUserUseGalienInWorkspace(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const database = input.database ?? db;
  const membership = await database.query.workspaceMember.findFirst({
    where: and(
      eq(workspaceMember.userId, input.userId),
      eq(workspaceMember.workspaceId, input.workspaceId),
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
    return false;
  }

  const allowed = await database.query.galienWorkspaceAccess.findFirst({
    where: and(
      eq(galienWorkspaceAccess.workspaceId, input.workspaceId),
      eq(galienWorkspaceAccess.email, normalizedEmail),
    ),
    columns: { id: true },
  });

  return Boolean(allowed);
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
      createdByUserId: input.createdByUserId,
    })
    .onConflictDoUpdate({
      target: [galienWorkspaceAccess.workspaceId, galienWorkspaceAccess.email],
      set: {
        createdByUserId: input.createdByUserId,
      },
    })
    .returning();

  return entry;
}

export async function removeGalienWorkspaceAccess(input: {
  database?: DatabaseLike;
  id: string;
}) {
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
}) {
  const database = input.database ?? db;
  const credential = await database.query.galienCredential.findFirst({
    where: eq(galienCredential.userId, input.userId),
    columns: {
      id: true,
      displayName: true,
      galienUserId: true,
      validatedAt: true,
      updatedAt: true,
    },
  });

  return credential
    ? {
        connected: true,
        displayName: credential.displayName,
        galienUserId: credential.galienUserId,
        validatedAt: credential.validatedAt,
        updatedAt: credential.updatedAt,
      }
    : {
        connected: false,
        displayName: null,
        galienUserId: null,
        validatedAt: null,
        updatedAt: null,
      };
}

export async function setGalienCredential(input: {
  database?: DatabaseLike;
  userId: string;
  username: string;
  password: string;
}) {
  const database = input.database ?? db;
  const username = input.username.trim();
  const password = input.password.trim();
  const currentUser = await validateGalienCredentials({ username, password });
  const displayName = formatGalienDisplayName(currentUser);
  const now = new Date();

  const [credential] = await database
    .insert(galienCredential)
    .values({
      userId: input.userId,
      username: encrypt(username),
      password: encrypt(password),
      galienUserId: currentUser.id,
      displayName,
      validatedAt: now,
    })
    .onConflictDoUpdate({
      target: [galienCredential.userId],
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
}) {
  const database = input.database ?? db;
  await database.delete(galienCredential).where(eq(galienCredential.userId, input.userId));
}

export async function getGalienCredentialForUser(input: {
  database?: DatabaseLike;
  userId: string;
}): Promise<DecryptedGalienCredential | null> {
  const database = input.database ?? db;
  const credential = await database.query.galienCredential.findFirst({
    where: eq(galienCredential.userId, input.userId),
  });

  if (!credential) {
    return null;
  }

  return {
    username: decrypt(credential.username),
    password: decrypt(credential.password),
    displayName: credential.displayName,
    galienUserId: credential.galienUserId,
  };
}

export async function getGalienAccessStatus(input: {
  database?: DatabaseLike;
  userId: string;
  workspaceId: string;
}) {
  const [allowed, credential] = await Promise.all([
    canUserUseGalienInWorkspace(input),
    getGalienCredentialStatus(input),
  ]);

  return {
    allowed,
    ...credential,
  };
}
