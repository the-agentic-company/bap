import { db } from "@cmdclaw/db/client";
import { session, user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";

const DEFAULT_TEST_EMAIL = "baptiste@heybap.com";
const DEFAULT_TEST_NAME = "Baptiste";

const requestSchema = z.object({
  email: z.email().optional(),
  name: z.string().min(1).optional(),
  ttlHours: z.number().int().min(1).max(168).optional(),
});

function isAuthorized(request: Request): boolean {
  const expected = env.CMDCLAW_SERVER_SECRET ? `Bearer ${env.CMDCLAW_SERVER_SECRET}` : "";
  return Boolean(expected) && request.headers.get("authorization") === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const now = new Date();
  const email = parsed.data.email ?? DEFAULT_TEST_EMAIL;
  const name = parsed.data.name ?? DEFAULT_TEST_NAME;
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(user)
      .set({
        name,
        emailVerified: true,
        onboardedAt: existingUser.onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(user.id, existingUser.id));
  } else {
    userId = randomUUID();
    await db.insert(user).values({
      id: userId,
      email,
      name,
      emailVerified: true,
      onboardedAt: now,
      role: "user",
      createdAt: now,
      updatedAt: now,
    });
  }

  const ttlHours = parsed.data.ttlHours ?? 24;
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const token = randomBytes(48).toString("hex");

  await db.insert(session).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1",
    userAgent: request.headers.get("user-agent") ?? "cmdclaw-cli-test-auth",
  });

  return Response.json({
    email,
    expiresAt: expiresAt.toISOString(),
    token,
  });
}
