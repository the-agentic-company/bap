import { getTokensForIntegrations } from "@cmdclaw/core/server/integrations/cli-env";
import { generationInterruptService } from "@cmdclaw/core/server/services/generation-interrupt-service";
import { generationManager } from "@cmdclaw/core/server/services/generation-manager";
import { db } from "@cmdclaw/db/client";
import { generation } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authorizeRuntimeTurn, buildRuntimeAuthErrorResponse } from "@/server/internal/runtime-auth";

const integrationEnum = z.enum([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

const interruptCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plugin_write"),
    runtimeId: z.string().min(1),
    turnSeq: z.number().int().positive(),
    integration: integrationEnum,
    operation: z.string().min(1),
    command: z.string().optional(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    providerRequestId: z.string().min(1).optional(),
    runtimeTool: z
      .object({
        sessionId: z.string().min(1).optional(),
        messageId: z.string().min(1),
        partId: z.string().min(1),
        callId: z.string().min(1),
        toolName: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("auth"),
    runtimeId: z.string().min(1),
    turnSeq: z.number().int().positive(),
    integration: integrationEnum,
    reason: z.string().optional(),
  }),
]);

const interruptStatusSchema = z.object({
  runtimeId: z.string().min(1),
  turnSeq: z.number().int().positive(),
  interruptId: z.string().min(1),
});

/** POST /api/internal/runtime/interrupts/create */
export async function handleInterruptCreate(request: Request): Promise<Response> {
  try {
    const parsed = interruptCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const input = parsed.data;

    const authorized = await authorizeRuntimeTurn({
      runtimeId: input.runtimeId,
      turnSeq: input.turnSeq,
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!authorized.ok) {
      return buildRuntimeAuthErrorResponse(authorized.reason);
    }

    const generationRecord = await db.query.generation.findFirst({
      where: eq(generation.id, authorized.generationId),
      with: { conversation: true },
    });
    if (!generationRecord) {
      return Response.json({ error: "generation_not_found" }, { status: 404 });
    }

    const allowedIntegrations = await generationManager.getAllowedIntegrationsForGeneration(
      authorized.generationId,
    );
    if (Array.isArray(allowedIntegrations) && !allowedIntegrations.includes(input.integration)) {
      return Response.json({ error: "integration_not_allowed" }, { status: 403 });
    }

    if (input.kind === "plugin_write") {
      const created = await generationManager.requestPluginApproval(authorized.generationId, {
        integration: input.integration,
        operation: input.operation,
        command: input.command ?? "",
        toolInput: input.toolInput ?? {},
        providerRequestId: input.providerRequestId,
        runtimeTool: input.runtimeTool,
      });

      if (created.decision === "allow") {
        return Response.json({ status: "accepted" as const });
      }
      if (created.decision !== "pending" || !created.toolUseId) {
        return Response.json({ status: "rejected" as const });
      }

      const interrupt = await generationInterruptService.findPendingInterruptByToolUseId({
        generationId: authorized.generationId,
        providerToolUseId: created.toolUseId,
      });
      if (!interrupt) {
        return Response.json({ error: "interrupt_not_found" }, { status: 500 });
      }

      return Response.json({
        interruptId: interrupt.id,
        status: "pending" as const,
        expiresAt: created.expiresAt,
      });
    }

    const created = await generationManager.requestAuthInterrupt(authorized.generationId, {
      integration: input.integration,
      reason: input.reason,
    });

    if (created.status === "accepted") {
      return Response.json({ status: "accepted" as const });
    }

    return Response.json(created);
  } catch (error) {
    console.error("[Internal] runtime interrupt create error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST /api/internal/runtime/interrupts/status */
export async function handleInterruptStatus(request: Request): Promise<Response> {
  try {
    const parsed = interruptStatusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const input = parsed.data;

    const authorized = await authorizeRuntimeTurn({
      runtimeId: input.runtimeId,
      turnSeq: input.turnSeq,
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!authorized.ok) {
      return buildRuntimeAuthErrorResponse(authorized.reason);
    }

    const interrupt = await generationInterruptService.getInterrupt(input.interruptId);
    if (
      !interrupt ||
      interrupt.generationId !== authorized.generationId ||
      interrupt.runtimeId !== authorized.runtimeId ||
      interrupt.turnSeq !== authorized.turnSeq
    ) {
      return Response.json({ error: "interrupt_not_found" }, { status: 404 });
    }

    if (interrupt.kind === "auth" && interrupt.status === "accepted") {
      await generationInterruptService.markInterruptApplied(interrupt.id);
      const generationRecord = await db.query.generation.findFirst({
        where: eq(generation.id, interrupt.generationId),
        with: { conversation: true },
      });
      const integration =
        interrupt.responsePayload?.integration ?? interrupt.display.authSpec?.integrations[0];
      const tokens =
        generationRecord?.conversation.userId && integration
          ? await getTokensForIntegrations(generationRecord.conversation.userId, [integration])
          : undefined;
      return Response.json({
        interruptId: interrupt.id,
        status: interrupt.status,
        resolutionPayload: {
          ...interrupt.responsePayload,
          tokens,
        },
      });
    }

    if (interrupt.kind === "plugin_write" && interrupt.status === "accepted") {
      await generationInterruptService.markInterruptApplied(interrupt.id);
    }

    return Response.json({
      interruptId: interrupt.id,
      status: interrupt.status,
      resolutionPayload: interrupt.responsePayload ?? undefined,
    });
  } catch (error) {
    console.error("[Internal] runtime interrupt status error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
