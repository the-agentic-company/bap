import { execFile as execFileCb, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  normalizeOpencodeSessionSnapshotPayload,
  parseOpencodeSessionSnapshotPayload,
} from "./opencode-session-snapshot-service";

const execFile = promisify(execFileCb);
const hasOpencode = spawnSync("which", ["opencode"], { encoding: "utf8" }).status === 0;

async function runOpencode(
  args: string[],
  options: {
    cwd: string;
    homeDir: string;
    dataDir: string;
    configDir: string;
  },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFile("opencode", args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: options.homeDir,
      XDG_DATA_HOME: options.dataDir,
      XDG_CONFIG_HOME: options.configDir,
      XDG_STATE_HOME: path.join(options.homeDir, ".local", "state"),
    },
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("opencode session snapshot service", () => {
  it("parses snapshot payloads from mixed export output", () => {
    const snapshot = {
      info: {
        id: "ses_snapshot_mixed",
        directory: "/tmp/workspace",
      },
      messages: [],
    };

    expect(
      parseOpencodeSessionSnapshotPayload(`Exporting session ses_snapshot_mixed\n${JSON.stringify(snapshot)}\n`),
    ).toEqual(snapshot);
  });

  it("normalizes extracted snapshot payloads to pure JSON", () => {
    const snapshot = {
      info: {
        id: "ses_snapshot_normalized",
      },
      messages: [{ info: { id: "msg_1" }, parts: [] }],
    };

    expect(
      normalizeOpencodeSessionSnapshotPayload(
        `Exporting session ses_snapshot_normalized\n${JSON.stringify(snapshot)}\nExport complete\n`,
      ),
    ).toEqual({
      payload: snapshot,
      raw: JSON.stringify(snapshot),
    });
  });

  it("skips earlier JSON logs when normalizing mixed export output", () => {
    const logPayload = {
      level: "info",
      event: "tool.input",
      input: {
        question: "What should I do next?",
      },
    };
    const snapshot = {
      info: {
        id: "ses_snapshot_after_log",
      },
      messages: [{ info: { id: "msg_1" }, parts: [] }],
    };

    expect(
      normalizeOpencodeSessionSnapshotPayload(
        `Preparing export\n${JSON.stringify(logPayload)}\n${JSON.stringify(snapshot)}\n`,
      ),
    ).toEqual({
      payload: snapshot,
      raw: JSON.stringify(snapshot),
    });
  });

  it.skipIf(!hasOpencode)(
    "round-trips OpenCode export/import and keeps duplicate imports idempotent",
    async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmdclaw-opencode-"));
      const homeDir = path.join(tempRoot, "home");
      const dataDir = path.join(tempRoot, "data");
      const configDir = path.join(tempRoot, "config");
      const workspaceDir = path.join(tempRoot, "workspace");

      await Promise.all([
        mkdir(homeDir, { recursive: true }),
        mkdir(dataDir, { recursive: true }),
        mkdir(configDir, { recursive: true }),
        mkdir(workspaceDir, { recursive: true }),
      ]);

      const snapshot = {
        info: {
          id: "ses_snapshot_test",
          slug: "snapshot-test",
          projectID: "global",
          directory: workspaceDir,
          title: "Snapshot Test",
          version: "1.2.24",
          summary: {
            additions: 0,
            deletions: 0,
            files: 0,
          },
          time: {
            created: 1773865522472,
            updated: 1773865524649,
          },
        },
        messages: [
          {
            info: {
              role: "user",
              time: {
                created: 1773865522481,
              },
              summary: {
                diffs: [],
              },
              agent: "build",
              model: {
                providerID: "openai",
                modelID: "gpt-5.4",
              },
              id: "msg_snapshot_user",
              sessionID: "ses_snapshot_test",
            },
            parts: [
              {
                type: "text",
                text: "hi",
                id: "prt_snapshot_user",
                sessionID: "ses_snapshot_test",
                messageID: "msg_snapshot_user",
              },
            ],
          },
          {
            info: {
              role: "assistant",
              time: {
                created: 1773865522493,
                completed: 1773865524651,
              },
              parentID: "msg_snapshot_user",
              modelID: "gpt-5.4",
              providerID: "openai",
              mode: "build",
              agent: "build",
              path: {
                cwd: workspaceDir,
                root: "/",
              },
              cost: 0,
              tokens: {
                total: 8913,
                input: 8898,
                output: 15,
                reasoning: 0,
                cache: {
                  read: 0,
                  write: 0,
                },
              },
              finish: "stop",
              id: "msg_snapshot_assistant",
              sessionID: "ses_snapshot_test",
            },
            parts: [
              {
                type: "step-start",
                id: "prt_snapshot_start",
                sessionID: "ses_snapshot_test",
                messageID: "msg_snapshot_assistant",
              },
              {
                type: "tool",
                callID: "toolu_snapshot_question",
                tool: "question",
                state: {
                  status: "running",
                  input: {
                    questions: [
                      {
                        question: "What should I do next?",
                        header: "Next step",
                        options: [
                          {
                            label: "Keep going (Recommended)",
                            description: "Continue the current implementation",
                          },
                        ],
                      },
                    ],
                  },
                  time: {
                    start: 1773865523000,
                  },
                },
                id: "prt_snapshot_tool",
                sessionID: "ses_snapshot_test",
                messageID: "msg_snapshot_assistant",
              },
              {
                type: "step-finish",
                reason: "stop",
                cost: 0,
                tokens: {
                  total: 8913,
                  input: 8898,
                  output: 15,
                  reasoning: 0,
                  cache: {
                    read: 0,
                    write: 0,
                  },
                },
                id: "prt_snapshot_finish",
                sessionID: "ses_snapshot_test",
                messageID: "msg_snapshot_assistant",
              },
            ],
          },
        ],
      };

      const snapshotPath = path.join(tempRoot, "snapshot.json");
      await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

      try {
        const firstImport = await runOpencode(["import", snapshotPath], {
          cwd: workspaceDir,
          homeDir,
          dataDir,
          configDir,
        });
        expect(firstImport.stdout).toContain("Imported session: ses_snapshot_test");

        const exported = await runOpencode(["export", "ses_snapshot_test"], {
          cwd: workspaceDir,
          homeDir,
          dataDir,
          configDir,
        });
        const exportedPayload = JSON.parse(exported.stdout) as typeof snapshot;
        expect(exportedPayload.info.id).toBe("ses_snapshot_test");
        expect(exportedPayload.messages.map((message) => message.info.id)).toEqual([
          "msg_snapshot_user",
          "msg_snapshot_assistant",
        ]);
        expect(
          exportedPayload.messages[1]?.parts.find((part) => part.id === "prt_snapshot_tool"),
        ).toMatchObject({
          type: "tool",
          tool: "question",
        });

        await runOpencode(["import", snapshotPath], {
          cwd: workspaceDir,
          homeDir,
          dataDir,
          configDir,
        });

        const dbPath = path.join(dataDir, "opencode", "opencode.db");
        const dbExists = await readFile(dbPath);
        expect(dbExists.byteLength).toBeGreaterThan(0);

        const messageCountResult = await runOpencode(
          [
            "db",
            "SELECT count(*) AS c FROM message WHERE session_id='ses_snapshot_test';",
            "--format",
            "json",
          ],
          {
            cwd: workspaceDir,
            homeDir,
            dataDir,
            configDir,
          },
        );
        const partCountResult = await runOpencode(
          [
            "db",
            "SELECT count(*) AS c FROM part WHERE session_id='ses_snapshot_test';",
            "--format",
            "json",
          ],
          {
            cwd: workspaceDir,
            homeDir,
            dataDir,
            configDir,
          },
        );

        expect(JSON.parse(messageCountResult.stdout)).toEqual([{ c: 2 }]);
        expect(JSON.parse(partCountResult.stdout)).toEqual([{ c: 4 }]);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
