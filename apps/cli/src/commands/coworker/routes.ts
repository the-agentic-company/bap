import { buildCommand, buildRouteMap } from "@stricli/core";

const commonServerFlags = {
  server: {
    kind: "parsed" as const,
    parse: (input: string) => input,
    optional: true as const,
    brief: "Server URL",
  },
  json: {
    kind: "boolean" as const,
    optional: true as const,
    brief: "Print JSON output",
  },
};

const coworkerListCommand = buildCommand({
  loader: async () => import("./list"),
  parameters: {
    flags: commonServerFlags,
    aliases: {
      s: "server",
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  docs: {
    brief: "List coworkers",
  },
});

const coworkerGetCommand = buildCommand({
  loader: async () => import("./get"),
  parameters: {
    flags: commonServerFlags,
    aliases: {
      s: "server",
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Coworker ID or @username",
          parse: (input: string) => input,
          placeholder: "coworker",
        },
      ],
    },
  },
  docs: {
    brief: "Get coworker details",
  },
});

const coworkerCreateCommand = buildCommand({
  loader: async () => import("./create"),
  parameters: {
    flags: {
      server: commonServerFlags.server,
      name: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Coworker name",
      },
      trigger: {
        kind: "parsed",
        parse: (input: string) => input,
        brief: "Trigger type",
      },
      prompt: {
        kind: "parsed",
        parse: (input: string) => input,
        brief: "Coworker prompt",
      },
      promptDo: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Additional do instructions",
      },
      promptDont: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Additional don't instructions",
      },
      autoApprove: {
        kind: "boolean",
        optional: true as const,
        brief: "Enable auto-approve",
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
      integrations: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Comma-separated allowed integrations",
      },
      json: commonServerFlags.json,
    },
    aliases: {
      s: "server",
      n: "name",
      t: "trigger",
      p: "prompt",
      M: "model",
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  docs: {
    brief: "Create a coworker",
  },
});

export const coworkerBuildCommand = buildCommand({
  loader: async () => import("./build"),
  parameters: {
    flags: {
      server: commonServerFlags.server,
      name: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Initial coworker name",
      },
      message: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Initial builder message",
      },
      attach: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Attach to an existing builder conversation",
      },
      trigger: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Initial trigger type",
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
      integrations: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Comma-separated allowed integrations",
      },
      autoApprove: {
        kind: "boolean",
        optional: true as const,
        brief: "Auto-approve builder tool calls",
      },
      open: {
        kind: "boolean",
        optional: true as const,
        brief: "Open auth URLs in the browser automatically",
      },
      file: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        variadic: true,
        brief: "Attach a file to the initial builder message",
      },
      validate: {
        kind: "boolean",
        default: true,
        brief: "Validate persisted assistant messages",
      },
      sandbox: {
        kind: "enum",
        values: ["e2b", "daytona", "docker"] as const,
        optional: true,
        brief: "Sandbox provider",
      },
      chaosRunDeadline: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Debug: override this builder generation's run deadline (for example 60s)",
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
    },
    aliases: {
      s: "server",
      n: "name",
      m: "message",
      c: "attach",
      t: "trigger",
      M: "model",
      f: "file",
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  docs: {
    brief: "Build a coworker through the conversational builder",
  },
});

const coworkerRunCommand = buildCommand({
  loader: async () => import("./run"),
  parameters: {
    flags: {
      server: commonServerFlags.server,
      payload: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "JSON payload passed to the run",
      },
      watch: {
        kind: "boolean",
        optional: true as const,
        brief: "Watch run logs after triggering",
      },
      "watch-interval": {
        kind: "parsed",
        parse: (input: string) => Number(input),
        optional: true,
        brief: "Watch interval in seconds",
      },
      chaosRunDeadline: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Debug: override this run's deadline (for example 60s)",
      },
      json: commonServerFlags.json,
    },
    aliases: {
      s: "server",
      P: "payload",
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Coworker ID or @username",
          parse: (input: string) => input,
          placeholder: "coworker",
        },
      ],
    },
  },
  docs: {
    brief: "Trigger a coworker run",
  },
});

const coworkerLogsCommand = buildCommand({
  loader: async () => import("./logs"),
  parameters: {
    flags: {
      server: commonServerFlags.server,
      watch: {
        kind: "boolean",
        optional: true as const,
        brief: "Watch for new run events",
      },
      "watch-interval": {
        kind: "parsed",
        parse: (input: string) => Number(input),
        optional: true,
        brief: "Watch interval in seconds",
      },
      json: commonServerFlags.json,
    },
    aliases: {
      s: "server",
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Run ID",
          parse: (input: string) => input,
          placeholder: "run-id",
        },
      ],
    },
  },
  docs: {
    brief: "Show coworker run logs",
  },
});

const coworkerApproveCommand = buildCommand({
  loader: async () => import("./approve"),
  parameters: {
    flags: {
      server: commonServerFlags.server,
    },
    aliases: {
      s: "server",
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Run ID",
          parse: (input: string) => input,
          placeholder: "run-id",
        },
        {
          brief: "Tool use ID",
          parse: (input: string) => input,
          placeholder: "tool-use-id",
        },
        {
          brief: "Decision",
          parse: (input: string) => input as "approve" | "deny",
          placeholder: "decision",
        },
      ],
    },
  },
  docs: {
    brief: "Approve or deny a pending coworker tool use",
  },
});

export const coworkerRoutes = buildRouteMap({
  routes: {
    list: coworkerListCommand,
    get: coworkerGetCommand,
    create: coworkerCreateCommand,
    build: coworkerBuildCommand,
    run: coworkerRunCommand,
    logs: coworkerLogsCommand,
    approve: coworkerApproveCommand,
  },
  docs: {
    brief: "Coworker commands",
  },
});
