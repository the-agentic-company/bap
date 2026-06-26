import { describe, expect, it } from "vitest";
import { schema as chatRunSchema } from "../tools/chat.run";
import { schema as coworkerCreateSchema } from "../tools/coworker.create";
import { schema as coworkerDeleteSchema } from "../tools/coworker.delete";
import { schema as coworkerDeleteDocumentSchema } from "../tools/coworker.deleteDocument";
import { schema as coworkerGetSchema } from "../tools/coworker.get";
import { schema as coworkerListSchema } from "../tools/coworker.list";
import { schema as coworkerLogsSchema } from "../tools/coworker.logs";
import { schema as coworkerMoveWorkspaceSchema } from "../tools/coworker.moveWorkspace";
import { schema as coworkerRunSchema } from "../tools/coworker.run";
import { schema as coworkerRunsSchema } from "../tools/coworker.runs";
import { schema as coworkerUpdateSchema } from "../tools/coworker.update";
import { schema as coworkerUpdateDocumentSchema } from "../tools/coworker.updateDocument";
import { schema as coworkerUploadDocumentSchema } from "../tools/coworker.uploadDocument";
import { schema as fileAssetCompleteUploadSchema } from "../tools/fileAsset.completeUpload";
import { schema as fileAssetCreateUploadSchema } from "../tools/fileAsset.createUpload";
import { schema as skillAddSchema } from "../tools/skill.add";
import { schema as workspaceListSchema } from "../tools/workspace.list";
import { schema as workspaceCreateSchema } from "../tools/workspace.create";
import { schema as workspaceAddMembersSchema } from "../tools/workspace.addMembers";
import { schema as workspaceSwitchSchema } from "../tools/workspace.switch";

const bapToolSchemas = {
  "chat.run": chatRunSchema,
  "coworker.create": coworkerCreateSchema,
  "coworker.delete": coworkerDeleteSchema,
  "coworker.deleteDocument": coworkerDeleteDocumentSchema,
  "coworker.get": coworkerGetSchema,
  "coworker.list": coworkerListSchema,
  "coworker.logs": coworkerLogsSchema,
  "coworker.moveWorkspace": coworkerMoveWorkspaceSchema,
  "coworker.run": coworkerRunSchema,
  "coworker.runs": coworkerRunsSchema,
  "coworker.update": coworkerUpdateSchema,
  "coworker.updateDocument": coworkerUpdateDocumentSchema,
  "coworker.uploadDocument": coworkerUploadDocumentSchema,
  "fileAsset.completeUpload": fileAssetCompleteUploadSchema,
  "fileAsset.createUpload": fileAssetCreateUploadSchema,
  "skill.add": skillAddSchema,
  "workspace.addMembers": workspaceAddMembersSchema,
  "workspace.create": workspaceCreateSchema,
  "workspace.list": workspaceListSchema,
  "workspace.switch": workspaceSwitchSchema,
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

  it("keeps workspace.list callable with empty input", () => {
    expect(Object.keys(workspaceListSchema)).toEqual([]);
  });
});
