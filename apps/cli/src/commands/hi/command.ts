import { buildCommand } from "@stricli/core";

export const hiCommand = buildCommand({
  loader: async () => import("./impl"),
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  docs: {
    brief: "Say hi",
  },
});
