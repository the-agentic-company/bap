import { encrypt, decrypt } from "@bap/core/server/lib/encryption";
import { customIntegration, customIntegrationCredential } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { generateCodeVerifier, generateCodeChallenge } from "./integration-shared";

// ========== CUSTOM INTEGRATIONS ==========

export const createCustomIntegration = protectedProcedure
  .input(
    z.object({
      slug: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9-]+$/),
      name: z.string().min(1).max(128),
      description: z.string().min(1).max(1000),
      iconUrl: z.string().url().nullish(),
      baseUrl: z.string().url(),
      authType: z.enum(["oauth2", "api_key", "bearer_token"]),
      oauthConfig: z
        .object({
          authUrl: z.string().url(),
          tokenUrl: z.string().url(),
          scopes: z.array(z.string()),
          pkce: z.boolean().optional(),
          authStyle: z.enum(["header", "params"]).optional(),
          extraAuthParams: z.record(z.string(), z.string()).optional(),
        })
        .nullish(),
      apiKeyConfig: z
        .object({
          method: z.enum(["header", "query"]),
          headerName: z.string().optional(),
          queryParam: z.string().optional(),
        })
        .nullish(),
      cliCode: z.string().default("// CLI code placeholder"),
      cliInstructions: z.string().default("Custom integration CLI"),
      permissions: z
        .object({
          readOps: z.array(z.string()),
          writeOps: z.array(z.string()),
        })
        .default({ readOps: [], writeOps: [] }),
      // Credentials (for the creating user)
      clientId: z.string().nullish(),
      clientSecret: z.string().nullish(),
      apiKey: z.string().nullish(),
    }),
  )
  .handler(async ({ input, context }) => {
    // Check slug uniqueness
    const existing = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, input.slug),
    });
    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Integration with slug '${input.slug}' already exists`,
      });
    }

    const [created] = await context.db
      .insert(customIntegration)
      .values({
        slug: input.slug,
        name: input.name,
        description: input.description,
        iconUrl: input.iconUrl ?? null,
        baseUrl: input.baseUrl,
        authType: input.authType,
        oauthConfig: input.oauthConfig
          ? {
              ...input.oauthConfig,
              extraAuthParams: input.oauthConfig.extraAuthParams as
                | Record<string, string>
                | undefined,
            }
          : null,
        apiKeyConfig: input.apiKeyConfig ?? null,
        cliCode: input.cliCode,
        cliInstructions: input.cliInstructions,
        permissions: input.permissions,
        createdByUserId: context.user.id,
      })
      .returning();

    // Save credentials if provided
    if (input.clientId || input.clientSecret || input.apiKey) {
      await context.db.insert(customIntegrationCredential).values({
        userId: context.user.id,
        customIntegrationId: created.id,
        clientId: input.clientId ? encrypt(input.clientId) : null,
        clientSecret: input.clientSecret ? encrypt(input.clientSecret) : null,
        apiKey: input.apiKey ? encrypt(input.apiKey) : null,
        enabled: true,
      });
    }

    return { id: created.id, slug: created.slug };
  });

export const listCustomIntegrations = protectedProcedure.handler(async ({ context }) => {
  const integrations = await context.db.query.customIntegration.findMany({
    where: or(
      eq(customIntegration.createdByUserId, context.user.id),
      eq(customIntegration.isBuiltIn, true),
    ),
  });

  // Get user's credentials for these integrations
  const credentials = await context.db.query.customIntegrationCredential.findMany({
    where: eq(customIntegrationCredential.userId, context.user.id),
  });

  const credMap = new Map(credentials.map((c) => [c.customIntegrationId, c]));

  return integrations.map((i) => {
    const cred = credMap.get(i.id);
    return {
      id: i.id,
      slug: i.slug,
      name: i.name,
      description: i.description,
      iconUrl: i.iconUrl,
      baseUrl: i.baseUrl,
      authType: i.authType,
      isBuiltIn: i.isBuiltIn,
      communityStatus: i.communityStatus,
      communityPrUrl: i.communityPrUrl,
      createdAt: i.createdAt,
      connected: !!cred,
      enabled: cred?.enabled ?? false,
      displayName: cred?.displayName ?? null,
    };
  });
});

export const getCustomIntegration = protectedProcedure
  .input(z.object({ slug: z.string() }))
  .handler(async ({ input, context }) => {
    const integ = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, input.slug),
    });

    if (!integ) {
      throw new ORPCError("NOT_FOUND", {
        message: "Custom integration not found",
      });
    }

    const cred = await context.db.query.customIntegrationCredential.findFirst({
      where: and(
        eq(customIntegrationCredential.userId, context.user.id),
        eq(customIntegrationCredential.customIntegrationId, integ.id),
      ),
    });

    return {
      ...integ,
      connected: !!cred,
      enabled: cred?.enabled ?? false,
      displayName: cred?.displayName ?? null,
      hasClientId: !!cred?.clientId,
      hasClientSecret: !!cred?.clientSecret,
      hasApiKey: !!cred?.apiKey,
    };
  });

export const setCustomCredentials = protectedProcedure
  .input(
    z.object({
      customIntegrationId: z.string(),
      clientId: z.string().nullish(),
      clientSecret: z.string().nullish(),
      apiKey: z.string().nullish(),
      displayName: z.string().nullish(),
    }),
  )
  .handler(async ({ input, context }) => {
    const values = {
      userId: context.user.id,
      customIntegrationId: input.customIntegrationId,
      clientId: input.clientId ? encrypt(input.clientId) : null,
      clientSecret: input.clientSecret ? encrypt(input.clientSecret) : null,
      apiKey: input.apiKey ? encrypt(input.apiKey) : null,
      displayName: input.displayName ?? null,
      enabled: true,
    };

    await context.db
      .insert(customIntegrationCredential)
      .values(values)
      .onConflictDoUpdate({
        target: [
          customIntegrationCredential.userId,
          customIntegrationCredential.customIntegrationId,
        ],
        set: {
          clientId: values.clientId,
          clientSecret: values.clientSecret,
          apiKey: values.apiKey,
          displayName: values.displayName,
          updatedAt: new Date(),
        },
      });

    return { success: true };
  });

export const disconnectCustomIntegration = protectedProcedure
  .input(z.object({ customIntegrationId: z.string() }))
  .handler(async ({ input, context }) => {
    await context.db
      .delete(customIntegrationCredential)
      .where(
        and(
          eq(customIntegrationCredential.userId, context.user.id),
          eq(customIntegrationCredential.customIntegrationId, input.customIntegrationId),
        ),
      );

    return { success: true };
  });

export const toggleCustomIntegration = protectedProcedure
  .input(z.object({ customIntegrationId: z.string(), enabled: z.boolean() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(customIntegrationCredential)
      .set({ enabled: input.enabled })
      .where(
        and(
          eq(customIntegrationCredential.userId, context.user.id),
          eq(customIntegrationCredential.customIntegrationId, input.customIntegrationId),
        ),
      )
      .returning({ id: customIntegrationCredential.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Credential not found" });
    }

    return { success: true };
  });

export const deleteCustomIntegration = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .delete(customIntegration)
      .where(
        and(
          eq(customIntegration.id, input.id),
          eq(customIntegration.createdByUserId, context.user.id),
        ),
      )
      .returning({ id: customIntegration.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Custom integration not found",
      });
    }

    return { success: true };
  });

// Custom OAuth auth URL
export const getCustomAuthUrl = protectedProcedure
  .input(
    z.object({
      slug: z.string(),
      redirectUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    const integ = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, input.slug),
    });
    if (!integ || integ.authType !== "oauth2" || !integ.oauthConfig) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Not a valid OAuth2 custom integration",
      });
    }

    const cred = await context.db.query.customIntegrationCredential.findFirst({
      where: and(
        eq(customIntegrationCredential.userId, context.user.id),
        eq(customIntegrationCredential.customIntegrationId, integ.id),
      ),
    });

    if (!cred?.clientId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Client credentials not configured",
      });
    }

    const clientId = decrypt(cred.clientId);
    const oauth = integ.oauthConfig;

    const codeVerifier = oauth.pkce ? generateCodeVerifier() : undefined;

    const state = Buffer.from(
      JSON.stringify({
        userId: context.user.id,
        type: `custom_${integ.slug}`,
        redirectUrl: input.redirectUrl,
        codeVerifier,
      }),
    ).toString("base64url");

    const appUrl = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${appUrl}/api/oauth/callback`,
      response_type: "code",
      state,
      scope: oauth.scopes.join(" "),
    });

    if (codeVerifier) {
      params.set("code_challenge", generateCodeChallenge(codeVerifier));
      params.set("code_challenge_method", "S256");
    }

    if (oauth.extraAuthParams) {
      for (const [k, v] of Object.entries(oauth.extraAuthParams)) {
        params.set(k, v);
      }
    }

    return { authUrl: `${oauth.authUrl}?${params}` };
  });

// Custom OAuth callback handler
export const handleCustomCallback = protectedProcedure
  .input(
    z.object({
      code: z.string(),
      state: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    let stateData: {
      userId: string;
      type: string;
      redirectUrl: string;
      codeVerifier?: string;
    };
    try {
      stateData = JSON.parse(Buffer.from(input.state, "base64url").toString());
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid state parameter",
      });
    }

    if (stateData.userId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "User mismatch" });
    }

    const slug = stateData.type.replace("custom_", "");
    const integ = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, slug),
    });

    if (!integ || !integ.oauthConfig) {
      throw new ORPCError("NOT_FOUND", {
        message: "Custom integration not found",
      });
    }

    const cred = await context.db.query.customIntegrationCredential.findFirst({
      where: and(
        eq(customIntegrationCredential.userId, context.user.id),
        eq(customIntegrationCredential.customIntegrationId, integ.id),
      ),
    });

    if (!cred?.clientId || !cred?.clientSecret) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Client credentials not configured",
      });
    }

    const clientId = decrypt(cred.clientId);
    const clientSecret = decrypt(cred.clientSecret);
    const oauth = integ.oauthConfig;
    const appUrl = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: `${appUrl}/api/oauth/callback`,
    });

    if (stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (oauth.authStyle === "header") {
      headers["Authorization"] =
        `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      tokenBody.set("client_id", clientId);
      tokenBody.set("client_secret", clientSecret);
    }

    const tokenResponse = await fetch(oauth.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Custom OAuth token exchange failed:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to exchange code for tokens",
      });
    }

    const tokens = await tokenResponse.json();

    // Update credential with tokens
    await context.db
      .update(customIntegrationCredential)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        enabled: true,
      })
      .where(eq(customIntegrationCredential.id, cred.id));

    return { success: true, redirectUrl: stateData.redirectUrl };
  });
