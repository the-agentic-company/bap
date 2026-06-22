import {
  disconnectCloudManagedIntegration,
  getCloudManagedIntegrationConnectUrl,
  listCloudManagedIntegrations,
  startCloudAccountLink,
  toggleCloudManagedIntegration,
} from "@bap/core/server/control-plane/client";
import { getCloudAccountLinkForUser } from "@bap/core/server/control-plane/local-links";
import { isSelfHostedEdition } from "@bap/core/server/edition";
import { normalizeAccountLabel } from "@bap/core/server/integrations/account-labels";
import { assignConnectedIdentityForProviderAccount } from "@bap/core/server/integrations/connected-identities";
import { getOAuthConfig, type IntegrationType } from "@bap/core/server/oauth/config";
import { integration, integrationToken, connectedIdentity } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { fetchDynamicsInstances } from "@/server/integrations/dynamics";
import {
  generateLinkedInAuthUrl,
  deleteUnipileAccount,
  getUnipileAccount,
} from "@/server/integrations/unipile";
import { protectedProcedure } from "../middleware";
import {
  getGoogleAccessStatus,
  listGoogleAccessAllowlist,
  listApprovedLoginEmailAllowlist,
  addApprovedLoginEmailAllowlistEntry,
  removeApprovedLoginEmailAllowlistEntry,
  addGoogleAccessAllowlistEntry,
  removeGoogleAccessAllowlistEntry,
  requestGoogleAccess,
} from "./integration-access";
import {
  createCustomIntegration,
  listCustomIntegrations,
  getCustomIntegration,
  setCustomCredentials,
  disconnectCustomIntegration,
  toggleCustomIntegration,
  deleteCustomIntegration,
  getCustomAuthUrl,
  handleCustomCallback,
} from "./integration-custom";
import {
  GOOGLE_INTEGRATION_TYPES,
  canUserAccessGoogleIntegrations,
  generateCodeVerifier,
  generateCodeChallenge,
  integrationTypeSchema,
} from "./integration-shared";

// List user's integrations
const list = protectedProcedure.handler(async ({ context }) => {
  if (isSelfHostedEdition()) {
    const link = await getCloudAccountLinkForUser(context.user.id);
    if (!link) {
      return [];
    }

    const integrations = await listCloudManagedIntegrations(context.user.id);
    return integrations.map((item) =>
      Object.assign(item, {
        createdAt: new Date(item.createdAt),
      }),
    );
  }

  const integrations = await context.db.query.integration.findMany({
    where: eq(integration.userId, context.user.id),
    with: {
      connectedIdentity: true,
    },
  });

  return integrations.map((i) => {
    const metadata =
      typeof i.metadata === "object" && i.metadata !== null
        ? (i.metadata as Record<string, unknown>)
        : null;

    const instanceName =
      i.type === "dynamics" && typeof metadata?.instanceName === "string"
        ? metadata.instanceName
        : null;
    const instanceUrl =
      i.type === "dynamics" && typeof metadata?.instanceUrl === "string"
        ? metadata.instanceUrl
        : null;

    return {
      id: i.id,
      type: i.type,
      displayName: i.displayName,
      enabled: i.enabled,
      setupRequired: i.type === "dynamics" && metadata?.pendingInstanceSelection === true,
      instanceName,
      instanceUrl,
      authStatus: i.authStatus,
      authErrorCode: i.authErrorCode,
      scopes: i.scopes,
      accountLabelId: i.connectedIdentity?.id ?? null,
      accountLabel: i.connectedIdentity?.label ?? null,
      createdAt: i.createdAt,
    };
  });
});

const listAccountLabels = protectedProcedure.handler(async ({ context }) => {
  const identities = await context.db.query.connectedIdentity.findMany({
    where: eq(connectedIdentity.userId, context.user.id),
    with: {
      integrations: true,
    },
  });

  return identities.map((identity) => ({
    id: identity.id,
    accountLabel: identity.label,
    emailIdentity: identity.emailIdentity,
    connectedAccounts: identity.integrations.map((item) => ({
      id: item.id,
      integrationType: item.type,
      displayName: item.displayName,
      enabled: item.enabled,
      authStatus: item.authStatus,
      providerAccountId: item.providerAccountId,
    })),
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  }));
});

const renameAccountLabel = protectedProcedure
  .input(z.object({ id: z.string(), accountLabel: z.string() }))
  .handler(async ({ input, context }) => {
    const accountLabel = normalizeAccountLabel(input.accountLabel);
    const result = await context.db
      .update(connectedIdentity)
      .set({ label: accountLabel })
      .where(and(eq(connectedIdentity.id, input.id), eq(connectedIdentity.userId, context.user.id)))
      .returning({ id: connectedIdentity.id, accountLabel: connectedIdentity.label });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Account Label not found" });
    }

    return result[0];
  });

const moveConnectedAccount = protectedProcedure
  .input(
    z.object({
      connectedAccountId: z.string(),
      destinationConnectedIdentityId: z.string().optional(),
      destinationAccountLabel: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const existing = await context.db.query.integration.findFirst({
      where: and(
        eq(integration.id, input.connectedAccountId),
        eq(integration.userId, context.user.id),
      ),
    });
    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Connected Account not found" });
    }

    let destinationId = input.destinationConnectedIdentityId ?? null;
    if (!destinationId) {
      if (!input.destinationAccountLabel) {
        throw new ORPCError("BAD_REQUEST", { message: "Destination Account Label is required" });
      }
      const label = normalizeAccountLabel(input.destinationAccountLabel);
      const existingDestination = await context.db.query.connectedIdentity.findFirst({
        where: and(
          eq(connectedIdentity.userId, context.user.id),
          eq(connectedIdentity.label, label),
        ),
      });
      if (existingDestination) {
        destinationId = existingDestination.id;
      } else {
        const [created] = await context.db
          .insert(connectedIdentity)
          .values({ userId: context.user.id, label })
          .returning({ id: connectedIdentity.id });
        destinationId = created.id;
      }
    }

    const destination = await context.db.query.connectedIdentity.findFirst({
      where: and(
        eq(connectedIdentity.id, destinationId),
        eq(connectedIdentity.userId, context.user.id),
      ),
      with: { integrations: true },
    });
    if (!destination) {
      throw new ORPCError("NOT_FOUND", { message: "Destination Account Label not found" });
    }
    if (
      destination.integrations.some(
        (item) => item.type === existing.type && item.id !== existing.id,
      )
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Account Label "${destination.label}" already has a Connected Account for ${existing.type}.`,
      });
    }

    await context.db
      .update(integration)
      .set({ connectedIdentityId: destination.id })
      .where(eq(integration.id, existing.id));

    return { success: true, connectedIdentityId: destination.id, accountLabel: destination.label };
  });

// Get OAuth authorization URL
const getAuthUrl = protectedProcedure
  .input(
    z.object({
      type: integrationTypeSchema,
      redirectUrl: z.string().url(),
      mode: z.enum(["connect", "connect_to_label", "reauth"]).optional(),
      accountLabel: z.string().optional(),
      connectedAccountId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      const link = await getCloudAccountLinkForUser(context.user.id);
      if (!link) {
        return {
          authUrl: await startCloudAccountLink({
            userId: context.user.id,
            requestedIntegrationType: input.type,
            returnPath: "/toolbox",
          }),
        };
      }

      return { authUrl: getCloudManagedIntegrationConnectUrl(input.type) };
    }

    // LinkedIn uses Unipile hosted auth instead of standard OAuth
    if (input.type === "linkedin") {
      let url: string;
      try {
        url = await generateLinkedInAuthUrl(context.user.id, input.redirectUrl);
      } catch (error) {
        if (isUnipileMissingCredentialsError(error)) {
          throw new ORPCError("BAD_REQUEST", {
            message: UNIPILE_MISSING_CREDENTIALS_MESSAGE,
          });
        }
        throw error;
      }
      return { authUrl: url };
    }

    if (GOOGLE_INTEGRATION_TYPES.has(input.type as IntegrationType)) {
      const allowed = await canUserAccessGoogleIntegrations(context);
      if (!allowed) {
        throw new ORPCError("FORBIDDEN", {
          message: "Google integrations require admin approval. Request access first.",
        });
      }
    }

    const config = getOAuthConfig(input.type as IntegrationType);

    // Generate PKCE code_verifier for providers that require it
    const pkceProviders = ["airtable", "salesforce"];
    const codeVerifier = pkceProviders.includes(input.type) ? generateCodeVerifier() : undefined;

    const state = Buffer.from(
      JSON.stringify({
        userId: context.user.id,
        type: input.type,
        redirectUrl: input.redirectUrl,
        codeVerifier, // Store verifier in state for Airtable
        mode: input.mode ?? "connect",
        accountLabel: input.accountLabel,
        connectedAccountId: input.connectedAccountId,
      }),
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state,
    });

    // For Slack, use user_scope to get user tokens instead of bot tokens
    if (input.type === "slack") {
      params.set("user_scope", config.scopes.join(" "));
    } else {
      params.set("scope", config.scopes.join(" "));
    }

    // Add provider-specific params
    const googleTypes = [
      "google_gmail",
      "google_calendar",
      "google_docs",
      "google_sheets",
      "google_drive",
    ];
    if (googleTypes.includes(input.type)) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    if (input.type === "outlook" || input.type === "outlook_calendar") {
      params.set("prompt", "select_account");
    }

    if (input.type === "notion") {
      params.set("owner", "user");
    }

    // Airtable and Salesforce require PKCE
    if (codeVerifier) {
      params.set("code_challenge", generateCodeChallenge(codeVerifier));
      params.set("code_challenge_method", "S256");
    }

    return { authUrl: `${config.authUrl}?${params}` };
  });

// Handle OAuth callback (called from callback route)
const handleCallback = protectedProcedure
  .input(
    z.object({
      code: z.string(),
      state: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      throw new ORPCError("FORBIDDEN", {
        message: "OAuth callbacks are handled by the cloud control plane in self-hosted mode",
      });
    }

    let stateData: {
      userId: string;
      type: IntegrationType;
      redirectUrl: string;
      codeVerifier?: string;
      accountLabel?: string;
      connectedAccountId?: string;
      mode?: "connect" | "connect_to_label" | "reauth";
    };

    try {
      stateData = JSON.parse(Buffer.from(input.state, "base64url").toString());
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid state parameter",
      });
    }

    // Verify user matches
    if (stateData.userId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "User mismatch" });
    }

    const config = getOAuthConfig(stateData.type);

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    });

    // Airtable and Salesforce require code_verifier for PKCE
    if (stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
    }

    // Notion requires Basic auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Notion and Airtable require Basic auth header
    if (stateData.type === "notion" || stateData.type === "airtable") {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`;
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_id");
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_secret");
    }

    // GitHub needs Accept header
    if (stateData.type === "github") {
      headers["Accept"] = "application/json";
    }

    // Debug logging for token exchange
    console.log("Token exchange request:", {
      url: config.tokenUrl,
      headers: {
        ...headers,
        Authorization: headers.Authorization ? "[REDACTED]" : undefined,
      },
      body: Object.fromEntries(tokenBody.entries()),
      clientIdPresent: !!config.clientId,
      clientSecretPresent: !!config.clientSecret,
      clientIdLength: config.clientId?.length,
    });

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Token exchange failed:", error);
      console.error("Response status:", tokenResponse.status);
      console.error("Response headers:", Object.fromEntries(tokenResponse.headers.entries()));
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to exchange code for tokens",
      });
    }

    const tokens = await tokenResponse.json();

    // Handle different response formats per provider
    // Slack user tokens are in authed_user.access_token
    let accessToken: string;
    if (stateData.type === "slack") {
      accessToken = tokens.authed_user?.access_token;
      if (!accessToken) {
        console.error("Slack token response:", JSON.stringify(tokens, null, 2));
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to get Slack user token",
        });
      }
    } else {
      accessToken = tokens.access_token;
    }

    // Get user info from provider
    const userInfo = await config.getUserInfo(accessToken);

    if (stateData.type === "dynamics") {
      const instances = await fetchDynamicsInstances(accessToken);
      if (instances.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "No Dynamics environments available",
        });
      }
      userInfo.metadata = {
        ...userInfo.metadata,
        pendingInstanceSelection: true,
        availableInstances: instances,
      };
    }

    const assignment = await assignConnectedIdentityForProviderAccount(context.db, {
      userId: context.user.id,
      integrationType: stateData.type,
      providerAccountId: userInfo.id,
      displayName: userInfo.displayName,
      metadata: userInfo.metadata,
      requestedAccountLabel: stateData.accountLabel,
    });
    const explicitReauthIntegration =
      stateData.connectedAccountId && stateData.mode === "reauth"
        ? await context.db.query.integration.findFirst({
            where: and(
              eq(integration.id, stateData.connectedAccountId),
              eq(integration.userId, context.user.id),
              eq(integration.type, stateData.type),
            ),
          })
        : null;

    if (
      explicitReauthIntegration?.providerAccountId &&
      explicitReauthIntegration.providerAccountId !== userInfo.id
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Reauth returned a different Provider Identity for this Account Label and Integration Type",
      });
    }

    const existingIntegration =
      explicitReauthIntegration ??
      (await context.db.query.integration.findFirst({
        where: and(
          eq(integration.userId, context.user.id),
          eq(integration.type, stateData.type),
          eq(integration.providerAccountId, userInfo.id),
        ),
      }));

    let integId: string;

    if (existingIntegration) {
      await context.db
        .update(integration)
        .set({
          providerAccountId: userInfo.id,
          connectedIdentityId: assignment.connectedIdentityId,
          displayName: userInfo.displayName,
          scopes: config.scopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics",
          authStatus: "connected",
          authErrorCode: null,
          authErrorAt: null,
          authErrorDetail: null,
        })
        .where(eq(integration.id, existingIntegration.id));
      integId = existingIntegration.id;
    } else {
      const [newInteg] = await context.db
        .insert(integration)
        .values({
          userId: context.user.id,
          type: stateData.type,
          connectedIdentityId: assignment.connectedIdentityId,
          providerAccountId: userInfo.id,
          displayName: userInfo.displayName,
          scopes: config.scopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics",
          authStatus: "connected",
          authErrorCode: null,
          authErrorAt: null,
          authErrorDetail: null,
        })
        .returning();
      integId = newInteg.id;
    }

    // Delete old tokens and store new ones
    await context.db.delete(integrationToken).where(eq(integrationToken.integrationId, integId));

    await context.db.insert(integrationToken).values({
      integrationId: integId,
      accessToken: accessToken,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      idToken: tokens.id_token,
    });

    return {
      success: true,
      integrationId: integId,
      redirectUrl: stateData.redirectUrl,
    };
  });

// Toggle integration enabled/disabled
const toggle = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      await toggleCloudManagedIntegration({
        userId: context.user.id,
        integrationId: input.id,
        enabled: input.enabled,
      });
      return { success: true };
    }

    const existing = await context.db.query.integration.findFirst({
      where: and(eq(integration.id, input.id), eq(integration.userId, context.user.id)),
    });

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    if (
      existing.type === "dynamics" &&
      input.enabled &&
      typeof existing.metadata === "object" &&
      existing.metadata !== null &&
      (existing.metadata as Record<string, unknown>).pendingInstanceSelection === true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Complete Dynamics environment selection before enabling the integration",
      });
    }

    const result = await context.db
      .update(integration)
      .set({ enabled: input.enabled })
      .where(and(eq(integration.id, input.id), eq(integration.userId, context.user.id)))
      .returning({ id: integration.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    return { success: true };
  });

// Disconnect integration
const disconnect = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    if (isSelfHostedEdition()) {
      await disconnectCloudManagedIntegration({
        userId: context.user.id,
        integrationId: input.id,
      });
      return { success: true };
    }

    // First, get the integration to check if it's LinkedIn
    const existingIntegration = await context.db.query.integration.findFirst({
      where: and(eq(integration.id, input.id), eq(integration.userId, context.user.id)),
    });

    if (!existingIntegration) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    // For LinkedIn, also delete the Unipile account
    if (existingIntegration.type === "linkedin" && existingIntegration.providerAccountId) {
      try {
        await deleteUnipileAccount(existingIntegration.providerAccountId);
      } catch (error) {
        console.error("Failed to delete Unipile account:", error);
        // Continue with deletion even if Unipile deletion fails
      }
    }

    await context.db.delete(integration).where(eq(integration.id, input.id));
    if (existingIntegration.connectedIdentityId) {
      const remaining = await context.db.query.integration.findFirst({
        where: eq(integration.connectedIdentityId, existingIntegration.connectedIdentityId),
      });
      if (!remaining) {
        await context.db
          .delete(connectedIdentity)
          .where(eq(connectedIdentity.id, existingIntegration.connectedIdentityId));
      }
    }

    return { success: true };
  });

// Link LinkedIn account after redirect (Unipile strips query params from webhook notify_url)
const linkLinkedIn = protectedProcedure
  .input(z.object({ accountId: z.string() }))
  .handler(async ({ input, context }) => {
    try {
      const account = await getUnipileAccount(input.accountId);

      const integrationData = {
        providerAccountId: input.accountId,
        displayName: account.name || account.identifier,
        enabled: true,
        authStatus: "connected" as const,
        authErrorCode: null,
        authErrorAt: null,
        authErrorDetail: null,
        metadata: {
          unipileAccountId: input.accountId,
          linkedinIdentifier: account.identifier,
        },
      };

      const assignment = await assignConnectedIdentityForProviderAccount(context.db, {
        userId: context.user.id,
        integrationType: "linkedin",
        providerAccountId: input.accountId,
        displayName: integrationData.displayName,
        metadata: integrationData.metadata,
      });
      const existingIntegration = await context.db.query.integration.findFirst({
        where: and(
          eq(integration.userId, context.user.id),
          eq(integration.type, "linkedin"),
          eq(integration.providerAccountId, input.accountId),
        ),
      });

      if (existingIntegration) {
        await context.db
          .update(integration)
          .set({
            ...integrationData,
            connectedIdentityId: assignment.connectedIdentityId,
          })
          .where(eq(integration.id, existingIntegration.id));
      } else {
        await context.db.insert(integration).values({
          userId: context.user.id,
          type: "linkedin",
          connectedIdentityId: assignment.connectedIdentityId,
          ...integrationData,
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Failed to link LinkedIn account:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to link LinkedIn account",
      });
    }
  });

export const integrationRouter = {
  list,
  listAccountLabels,
  renameAccountLabel,
  moveConnectedAccount,
  getGoogleAccessStatus,
  listApprovedLoginEmailAllowlist,
  addApprovedLoginEmailAllowlistEntry,
  removeApprovedLoginEmailAllowlistEntry,
  listGoogleAccessAllowlist,
  addGoogleAccessAllowlistEntry,
  removeGoogleAccessAllowlistEntry,
  requestGoogleAccess,
  getAuthUrl,
  handleCallback,
  toggle,
  disconnect,
  linkLinkedIn,
  // Custom integrations
  createCustomIntegration,
  listCustomIntegrations,
  getCustomIntegration,
  setCustomCredentials,
  disconnectCustomIntegration,
  toggleCustomIntegration,
  deleteCustomIntegration,
  getCustomAuthUrl,
  handleCustomCallback,
};
