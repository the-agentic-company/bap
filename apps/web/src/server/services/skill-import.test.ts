import { skill, skillDocument, skillFile } from "@bap/db/schema";
import { zipSync, strToU8 } from "fflate";
import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { createFileAssetFromBufferMock, markFileAssetReferenceMock, resolveUniqueSkillNameMock } =
  vi.hoisted(() => ({
    createFileAssetFromBufferMock: vi.fn<VitestProcedure>(),
    markFileAssetReferenceMock: vi.fn<VitestProcedure>(),
    resolveUniqueSkillNameMock: vi.fn<VitestProcedure>(),
  }));

vi.mock("@bap/core/server/services/file-asset-service", () => ({
  createFileAssetFromBuffer: createFileAssetFromBufferMock,
  markFileAssetReference: markFileAssetReferenceMock,
}));

vi.mock("@bap/core/server/services/workspace-skill-service", () => ({
  resolveUniqueSkillNameInWorkspace: resolveUniqueSkillNameMock,
}));

import { importSkill } from "./skill-import";

function createDatabase() {
  const insertedSkills: Array<Record<string, unknown>> = [];
  const insertedFiles: Array<Array<Record<string, unknown>>> = [];
  const insertedDocuments: Array<Array<Record<string, unknown>>> = [];

  const tx = {
    insert: vi.fn<VitestProcedure>((table: unknown) => {
      if (table === skill) {
        return {
          values: (values: Record<string, unknown>) => ({
            returning: async () => {
              const row = { id: "skill-1", ...values };
              insertedSkills.push(row);
              return [row];
            },
          }),
        };
      }

      if (table === skillFile) {
        return {
          values: async (values: Array<Record<string, unknown>>) => {
            insertedFiles.push(values);
          },
        };
      }

      if (table === skillDocument) {
        return {
          values: (values: Record<string, unknown>) => ({
            returning: async () => {
              insertedDocuments.push([values]);
              return [{ id: "document-1", ...values }];
            },
          }),
        };
      }

      throw new Error("Unexpected table");
    }),
  };

  const db = {
    transaction: vi.fn<VitestProcedure>(
      async (callback: (input: typeof tx) => Promise<unknown>) => await callback(tx),
    ),
  };

  return {
    db,
    insertedSkills,
    insertedFiles,
    insertedDocuments,
  };
}

function encodeZip(files: Record<string, Uint8Array | string>) {
  const entries = Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      typeof content === "string" ? strToU8(content) : content,
    ]),
  );
  return Buffer.from(zipSync(entries)).toString("base64");
}

describe("importSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFileAssetFromBufferMock.mockImplementation(
      async ({
        filename,
        mimeType,
        content,
      }: {
        filename: string;
        mimeType: string;
        content: Buffer;
      }) => ({
        id: "asset-logo",
        filename,
        mimeType,
        sizeBytes: content.length,
        storageKey: `file-assets/ws-1/server/${filename}`,
      }),
    );
    markFileAssetReferenceMock.mockResolvedValue(undefined);
    resolveUniqueSkillNameMock.mockImplementation(
      async (_database: unknown, _workspaceId: string, baseName: string) => baseName,
    );
  });

  it("imports a root-level zip with text files and binary assets", async () => {
    const database = createDatabase();
    const result = await importSkill(database.db as never, "user-1", "ws-1", {
      mode: "zip",
      filename: "weekly-report.zip",
      contentBase64: encodeZip({
        "SKILL.md": `---
name: weekly-report
description: Build a weekly report
---

# Weekly Report
`,
        "templates/report.md": "# Template\n",
        "assets/logo.png": new Uint8Array([137, 80, 78, 71]),
      }),
    });

    expect(result).toEqual({
      id: "skill-1",
      name: "weekly-report",
      displayName: "weekly-report",
      description: "Build a weekly report",
      enabled: true,
    });
    expect(database.insertedSkills[0]).toMatchObject({
      workspaceId: "ws-1",
      name: "weekly-report",
      displayName: "weekly-report",
      visibility: "private",
      enabled: true,
    });
    expect(database.insertedFiles[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "SKILL.md" }),
        expect.objectContaining({ path: "templates/report.md" }),
      ]),
    );
    expect(database.insertedDocuments[0]).toEqual([
      expect.objectContaining({
        fileAssetId: "asset-logo",
        filename: "logo.png",
        path: "assets/logo.png",
        mimeType: "image/png",
        storageKey: "file-assets/ws-1/server/logo.png",
      }),
    ]);
    expect(createFileAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "ws-1",
        filename: "logo.png",
        mimeType: "image/png",
      }),
    );
    expect(markFileAssetReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAssetId: "asset-logo",
        kind: "skill_document",
        referenceId: "document-1",
      }),
    );
  });

  it("strips a single top-level folder from zip imports", async () => {
    const database = createDatabase();

    const result = await importSkill(database.db as never, "user-1", "ws-1", {
      mode: "zip",
      filename: "weekly-report.zip",
      contentBase64: encodeZip({
        "weekly-report/SKILL.md": `---
name: weekly-report
description: Build a weekly report
---

# Weekly Report
`,
        "weekly-report/references/checklist.txt": "ship it",
      }),
    });

    expect(result.name).toBe("weekly-report");
    expect(database.insertedFiles[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "SKILL.md" }),
        expect.objectContaining({ path: "references/checklist.txt" }),
      ]),
    );
  });

  it("creates a suffixed copy when the skill slug already exists", async () => {
    const database = createDatabase();
    resolveUniqueSkillNameMock.mockResolvedValue("weekly-report-2");

    const result = await importSkill(database.db as never, "user-1", "ws-1", {
      mode: "folder",
      files: [
        {
          path: "SKILL.md",
          mimeType: "text/markdown",
          contentBase64: Buffer.from(`---
name: weekly-report
description: Build a weekly report
---

# Weekly Report
`).toString("base64"),
        },
      ],
    });

    expect(result.name).toBe("weekly-report-2");
    expect(result.displayName).toBe("weekly-report");
  });

  it("uses frontmatter name for displayName instead of placeholder headings", async () => {
    const database = createDatabase();

    const result = await importSkill(database.db as never, "user-1", "ws-1", {
      mode: "folder",
      files: [
        {
          path: "SKILL.md",
          mimeType: "text/markdown",
          contentBase64: Buffer.from(`---
name: qa
description: Test and fix bugs
---

# {Title}

Real content here.
`).toString("base64"),
        },
      ],
    });

    expect(result.name).toBe("qa");
    expect(result.displayName).toBe("qa");
    expect(database.insertedSkills[0]).toMatchObject({
      name: "qa",
      displayName: "qa",
    });
  });

  it("imports multiline descriptions from YAML block scalars", async () => {
    const database = createDatabase();

    const result = await importSkill(database.db as never, "user-1", "ws-1", {
      mode: "folder",
      files: [
        {
          path: "SKILL.md",
          mimeType: "text/markdown",
          contentBase64: Buffer.from(`---
name: qa
version: 2.0.0
description: |
  Systematically QA test a web application and fix bugs found.
  Produces before/after health scores.
allowed-tools:
  - Bash
  - Read
---

# QA
`).toString("base64"),
        },
      ],
    });

    expect(result.description).toBe(
      "Systematically QA test a web application and fix bugs found.\nProduces before/after health scores.",
    );
    expect(database.insertedSkills[0]).toMatchObject({
      description:
        "Systematically QA test a web application and fix bugs found.\nProduces before/after health scores.",
    });
  });

  it("rejects traversal paths in folder imports", async () => {
    const database = createDatabase();

    await expect(
      importSkill(database.db as never, "user-1", "ws-1", {
        mode: "folder",
        files: [
          {
            path: "../SKILL.md",
            mimeType: "text/markdown",
            contentBase64: Buffer.from("oops").toString("base64"),
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
