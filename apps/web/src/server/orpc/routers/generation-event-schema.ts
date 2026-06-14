import { z } from "zod";

// Schema for generation events (same structure as GenerationEvent type)
const generationEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("system"),
    content: z.string(),
    coworkerId: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_use"),
    toolName: z.string(),
    toolInput: z.unknown(),
    toolUseId: z.string().optional(),
    integration: z.string().optional(),
    operation: z.string().optional(),
    isWrite: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string(),
    result: z.unknown(),
    toolUseId: z.string().optional(),
  }),
  z.object({
    type: z.literal("thinking"),
    content: z.string(),
    thinkingId: z.string(),
  }),
  z.object({
    type: z.literal("interrupt_pending"),
    interruptId: z.string(),
    generationId: z.string(),
    runtimeId: z.string().nullable(),
    conversationId: z.string(),
    turnSeq: z.number().int().positive().nullable(),
    kind: z.enum(["plugin_write", "runtime_permission", "runtime_question", "auth"]),
    status: z.enum(["pending", "accepted", "rejected", "expired", "cancelled"]),
    providerToolUseId: z.string(),
    display: z.object({
      title: z.string(),
      integration: z.string().optional(),
      operation: z.string().optional(),
      command: z.string().optional(),
      toolInput: z.record(z.string(), z.unknown()).optional(),
      questionSpec: z
        .object({
          questions: z.array(
            z.object({
              header: z.string(),
              question: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  description: z.string().optional(),
                }),
              ),
              multiple: z.boolean().optional(),
              custom: z.boolean().optional(),
            }),
          ),
        })
        .optional(),
      authSpec: z
        .object({
          integrations: z.array(z.string()),
          reason: z.string().optional(),
        })
        .optional(),
    }),
    responsePayload: z
      .object({
        questionAnswers: z.array(z.array(z.string())).optional(),
        connectedIntegrations: z.array(z.string()).optional(),
        integration: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("interrupt_resolved"),
    interruptId: z.string(),
    generationId: z.string(),
    runtimeId: z.string().nullable(),
    conversationId: z.string(),
    turnSeq: z.number().int().positive().nullable(),
    kind: z.enum(["plugin_write", "runtime_permission", "runtime_question", "auth"]),
    status: z.enum(["pending", "accepted", "rejected", "expired", "cancelled"]),
    providerToolUseId: z.string(),
    display: z.object({
      title: z.string(),
      integration: z.string().optional(),
      operation: z.string().optional(),
      command: z.string().optional(),
      toolInput: z.record(z.string(), z.unknown()).optional(),
      questionSpec: z
        .object({
          questions: z.array(
            z.object({
              header: z.string(),
              question: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  description: z.string().optional(),
                }),
              ),
              multiple: z.boolean().optional(),
              custom: z.boolean().optional(),
            }),
          ),
        })
        .optional(),
      authSpec: z
        .object({
          integrations: z.array(z.string()),
          reason: z.string().optional(),
        })
        .optional(),
    }),
    responsePayload: z
      .object({
        questionAnswers: z.array(z.array(z.string())).optional(),
        connectedIntegrations: z.array(z.string()).optional(),
        integration: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("done"),
    generationId: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalCostUsd: z.number(),
    }),
    artifacts: z
      .object({
        timing: z
          .object({
            sandboxStartupDurationMs: z.number().optional(),
            sandboxStartupMode: z.enum(["created", "reused", "unknown"]).optional(),
            generationDurationMs: z.number().optional(),
            phaseDurationsMs: z
              .object({
                sandboxConnectOrCreateMs: z.number().optional(),
                opencodeReadyMs: z.number().optional(),
                sessionReadyMs: z.number().optional(),
                agentInitMs: z.number().optional(),
                prePromptSetupMs: z.number().optional(),
                waitForFirstEventMs: z.number().optional(),
                promptToFirstTokenMs: z.number().optional(),
                generationToFirstTokenMs: z.number().optional(),
                promptToFirstVisibleOutputMs: z.number().optional(),
                generationToFirstVisibleOutputMs: z.number().optional(),
                modelStreamMs: z.number().optional(),
                postProcessingMs: z.number().optional(),
              })
              .optional(),
            phaseTimestamps: z
              .array(
                z.object({
                  phase: z.string(),
                  at: z.string(),
                  elapsedMs: z.number(),
                }),
              )
              .optional(),
          })
          .optional(),
        attachments: z.array(
          z.object({
            id: z.string(),
            filename: z.string(),
            mimeType: z.string(),
            sizeBytes: z.number(),
          }),
        ),
        sandboxFiles: z.array(
          z.object({
            fileId: z.string(),
            path: z.string(),
            filename: z.string(),
            mimeType: z.string(),
            sizeBytes: z.number().nullable(),
          }),
        ),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("cancelled"),
    generationId: z.string(),
    conversationId: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("status_change"),
    status: z.string(),
    metadata: z
      .object({
        sandboxProvider: z.enum(["e2b", "daytona", "docker"]).optional(),
        runtimeId: z.string().optional(),
        runtimeHarness: z.enum(["opencode", "agent-sdk"]).optional(),
        runtimeProtocolVersion: z.enum(["opencode-v2", "sandbox-agent-v1"]).optional(),
        sandboxId: z.string().optional(),
        sessionId: z.string().optional(),
        parkedInterruptId: z.string().optional(),
        releasedSandboxId: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("sandbox_file"),
    fileId: z.string(),
    path: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().nullable(),
  }),
]);

export const generationEventSchema = z.intersection(
  z.object({
    cursor: z.string().optional(),
  }),
  generationEventPayloadSchema,
);
