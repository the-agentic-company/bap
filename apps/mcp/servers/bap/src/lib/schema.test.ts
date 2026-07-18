import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { schema as attachmentCompleteUpload } from "../tools/attachment.completeUpload";
import { schema as attachmentPrepareUpload } from "../tools/attachment.prepareUpload";
import { schema as chatRun } from "../tools/chat.run";
import { schema as connectedAccountConnect } from "../tools/connectedAccount.connect";
import { schema as connectedAccountDisconnect } from "../tools/connectedAccount.disconnect";
import { schema as connectedAccountRead } from "../tools/connectedAccount.read";
import { schema as coworkerDelete } from "../tools/coworker.delete";
import { schema as coworkerMoveWorkspace } from "../tools/coworker.moveWorkspace";
import { schema as coworkerRead } from "../tools/coworker.read";
import { schema as coworkerSave } from "../tools/coworker.save";
import { schema as coworkerDocumentDelete } from "../tools/coworkerDocument.delete";
import { schema as coworkerDocumentSave } from "../tools/coworkerDocument.save";
import { schema as coworkerRunCancel } from "../tools/coworkerRun.cancel";
import { schema as coworkerRunRead } from "../tools/coworkerRun.read";
import { schema as coworkerRunResume } from "../tools/coworkerRun.resume";
import { schema as coworkerRunStart } from "../tools/coworkerRun.start";
import { schema as runnerMarkFailed } from "../tools/runner.markFailed";
import { schema as skillDelete } from "../tools/skill.delete";
import { schema as skillRead } from "../tools/skill.read";
import { schema as skillSave } from "../tools/skill.save";
import { schema as workspaceList } from "../tools/workspace.list";
import { schema as workspaceSave } from "../tools/workspace.save";
import { schema as workspaceMcpServerDelete } from "../tools/workspaceMcpServer.delete";
import { schema as workspaceMcpServerList } from "../tools/workspaceMcpServer.list";
import { schema as workspaceMcpServerSave } from "../tools/workspaceMcpServer.save";
import { schema as workspaceMcpServerSetCredential } from "../tools/workspaceMcpServer.setCredential";
import { schema as workspaceMcpServerStartOAuth } from "../tools/workspaceMcpServer.startOAuth";
import { schema as workspaceMemberList } from "../tools/workspaceMember.list";
import { schema as workspaceMemberRemove } from "../tools/workspaceMember.remove";
import { schema as workspaceMemberSave } from "../tools/workspaceMember.save";

const schemas = {
  "attachment.completeUpload": attachmentCompleteUpload,
  "attachment.prepareUpload": attachmentPrepareUpload,
  "chat.run": chatRun,
  "connectedAccount.connect": connectedAccountConnect,
  "connectedAccount.disconnect": connectedAccountDisconnect,
  "connectedAccount.read": connectedAccountRead,
  "coworker.delete": coworkerDelete,
  "coworker.moveWorkspace": coworkerMoveWorkspace,
  "coworker.read": coworkerRead,
  "coworker.save": coworkerSave,
  "coworkerDocument.delete": coworkerDocumentDelete,
  "coworkerDocument.save": coworkerDocumentSave,
  "coworkerRun.cancel": coworkerRunCancel,
  "coworkerRun.read": coworkerRunRead,
  "coworkerRun.resume": coworkerRunResume,
  "coworkerRun.start": coworkerRunStart,
  "runner.markFailed": runnerMarkFailed,
  "skill.delete": skillDelete,
  "skill.read": skillRead,
  "skill.save": skillSave,
  "workspace.list": workspaceList,
  "workspace.save": workspaceSave,
  "workspaceMcpServer.delete": workspaceMcpServerDelete,
  "workspaceMcpServer.list": workspaceMcpServerList,
  "workspaceMcpServer.save": workspaceMcpServerSave,
  "workspaceMcpServer.setCredential": workspaceMcpServerSetCredential,
  "workspaceMcpServer.startOAuth": workspaceMcpServerStartOAuth,
  "workspaceMember.list": workspaceMemberList,
  "workspaceMember.remove": workspaceMemberRemove,
  "workspaceMember.save": workspaceMemberSave,
} as const;

const expectedNames = Object.keys(schemas).sort();

describe("Bap MCP tool contract", () => {
  it("registers exactly the 30 target tool modules", () => {
    const toolsDirectory = fileURLToPath(new URL("../tools", import.meta.url));
    const actualNames = readdirSync(toolsDirectory)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -3))
      .sort();
    expect(actualNames).toEqual(expectedNames);
  });

  it("does not expose transport configuration as tool arguments", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      expect(Object.hasOwn(schema, "serverUrl"), name).toBe(false);
    }
  });

  it("requires a nonblank workspaceId on every scoped tool", () => {
    const exceptions = new Set(["workspace.list", "workspace.save", "runner.markFailed"]);
    for (const [name, schema] of Object.entries(schemas)) {
      if (exceptions.has(name)) continue;
      const workspaceSchema = Reflect.get(schema, "workspaceId") as
        | { parse(value: unknown): unknown }
        | undefined;
      expect(workspaceSchema, name).toBeDefined();
      expect(() => workspaceSchema?.parse(undefined), name).toThrow();
      expect(() => workspaceSchema?.parse("   "), name).toThrow();
    }
  });

  it("keeps global and runtime-bound exceptions explicit", () => {
    expect(Object.keys(workspaceList)).toEqual([]);
    expect(() => workspaceSave.workspaceId.parse(undefined)).not.toThrow();
    expect(Object.hasOwn(runnerMarkFailed, "workspaceId")).toBe(false);
  });

  it("uses strict discriminated read operations", () => {
    expect(() => connectedAccountRead.query.parse({ type: "get" })).toThrow();
    expect(() =>
      connectedAccountRead.query.parse({ type: "list", connectedAccountId: "x" }),
    ).toThrow();
    expect(() => coworkerRead.query.parse({ type: "get", reference: "x", runId: "y" })).toThrow();
    expect(() => coworkerRunRead.query.parse({ type: "logs", runId: "r", fileId: "f" })).toThrow();
  });

  it("uses attachment rather than File Asset arguments publicly", () => {
    expect(Object.hasOwn(attachmentCompleteUpload, "attachmentId")).toBe(true);
    expect(Object.hasOwn(chatRun, "attachments")).toBe(true);
    expect(Object.hasOwn(chatRun, "fileAttachments")).toBe(false);
  });
});
