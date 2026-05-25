import { buildCommand } from "@stricli/core";

export const chatCommand = buildCommand({
  loader: async () => import("./impl"),
  parameters: {
    flags: {
      server: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Server URL",
      },
      conversation: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Continue an existing conversation",
      },
      message: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Send an initial message",
      },
      model: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Model reference",
      },
      authSource: {
        kind: "enum",
        values: ["user", "shared"] as const,
        optional: true,
        brief: "Model auth source",
      },
      sandbox: {
        kind: "enum",
        values: ["e2b", "daytona", "docker"] as const,
        optional: true,
        brief: "Sandbox provider",
      },
      listModels: {
        kind: "boolean",
        optional: true,
        brief: "List model options and exit",
      },
      autoApprove: {
        kind: "boolean",
        optional: true,
        brief: "Auto-approve tool calls",
      },
      open: {
        kind: "boolean",
        optional: true,
        brief: "Open auth URLs in the browser automatically",
      },
      chaosRunDeadline: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Debug: override this generation's run deadline (for example 60s)",
      },
      chaosApproval: {
        kind: "enum",
        values: ["ask", "defer"] as const,
        default: "ask",
        brief: "Debug: choose how CLI handles approval interrupts",
      },
      chaosApprovalParkAfter: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Debug: park a pending approval after this hot-wait duration (for example 5s)",
      },
      chaosRuntimeNoProgress: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Debug: override the post-prompt no-progress watchdog (for example 2s)",
      },
      chaosForceRuntimeNoProgress: {
        kind: "boolean",
        optional: true,
        brief: "Debug: force the no-progress watchdog to ignore runtime progress events",
      },
      attach: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Attach to the active run for a conversation",
      },
      attachGeneration: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Attach to an existing generation stream",
      },
      validate: {
        kind: "boolean",
        default: true,
        brief: "Validate persisted assistant messages",
      },
      questionAnswer: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        variadic: true,
        brief: "Pre-answer question prompts",
      },
      file: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        variadic: true,
        brief: "Attach a file to the message",
      },
      perfettoTrace: {
        kind: "boolean",
        optional: true,
        brief: "Write Perfetto trace JSON to perfetto-traces/",
      },
      timing: {
        kind: "boolean",
        optional: true,
        brief: "Show first/last assistant text timestamps",
      },
      token: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        hidden: true,
        brief: "Use a provided token directly",
      },
    },
    aliases: {
      s: "server",
      c: "conversation",
      m: "message",
      M: "model",
      f: "file",
      q: "questionAnswer",
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  docs: {
    brief: "Chat with CmdClaw",
  },
});
