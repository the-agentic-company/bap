import { describe, expect, it } from "vitest";
import { schema as chatRunSchema } from "./chat.run";
import { schema as coworkerCreateSchema } from "./coworker.create";
import { schema as coworkerDeleteDocumentSchema } from "./coworker.deleteDocument";
import { schema as coworkerGetSchema } from "./coworker.get";
import { schema as coworkerListSchema } from "./coworker.list";
import { schema as coworkerLogsSchema } from "./coworker.logs";
import { schema as coworkerRunSchema } from "./coworker.run";
import { schema as coworkerRunsSchema } from "./coworker.runs";
import { schema as coworkerUpdateSchema } from "./coworker.update";
import { schema as coworkerUpdateDocumentSchema } from "./coworker.updateDocument";
import { schema as coworkerUploadDocumentSchema } from "./coworker.uploadDocument";
import { schema as skillAddSchema } from "./skill.add";

const bapToolSchemas = {
  "chat.run": chatRunSchema,
  "coworker.create": coworkerCreateSchema,
  "coworker.deleteDocument": coworkerDeleteDocumentSchema,
  "coworker.get": coworkerGetSchema,
  "coworker.list": coworkerListSchema,
  "coworker.logs": coworkerLogsSchema,
  "coworker.run": coworkerRunSchema,
  "coworker.runs": coworkerRunsSchema,
  "coworker.update": coworkerUpdateSchema,
  "coworker.updateDocument": coworkerUpdateDocumentSchema,
  "coworker.uploadDocument": coworkerUploadDocumentSchema,
  "skill.add": skillAddSchema,
} as const;

describe("Bap MCP tool schemas", () => {
  it("does not expose serverUrl as a tool argument", () => {
    for (const [toolName, schema] of Object.entries(bapToolSchemas)) {
      expect(Object.hasOwn(schema, "serverUrl"), toolName).toBe(false);
    }
  });

  it("keeps coworker.list callable with empty input", () => {
    expect(Object.keys(coworkerListSchema)).toEqual([]);
  });
});
