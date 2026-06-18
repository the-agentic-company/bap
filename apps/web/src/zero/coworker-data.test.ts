import { describe, expect, it } from "vitest";
import { mapZeroCoworkerFolders, mapZeroCoworkerList, mapZeroCoworkerRun } from "./coworker-data";

describe("Zero coworker data adapters", () => {
  it("maps coworker inventory with pinned ordering and recent runs", () => {
    const coworkers = mapZeroCoworkerList([
      {
        id: "cw-older",
        name: "Older",
        status: "on",
        triggerType: "manual",
        model: "openai/gpt-5",
        requiresUserInput: false,
        autoApprove: true,
        isPinned: false,
        updatedAt: 1781130000000,
        runs: [],
      },
      {
        id: "cw-pinned",
        name: "Pinned",
        status: "off",
        triggerType: "schedule",
        model: "openai/gpt-5",
        requiresUserInput: true,
        autoApprove: false,
        toolAccessMode: "selected",
        isPinned: true,
        updatedAt: 1781120000000,
        runs: [
          {
            id: "run-older",
            coworkerId: "cw-pinned",
            status: "completed",
            conversationId: "chat-1",
            startedAt: 1781130100000,
          },
          {
            id: "run-newer",
            coworkerId: "cw-pinned",
            status: "running",
            generationId: "gen-1",
            startedAt: 1781130200000,
          },
        ],
      },
    ]);

    expect(coworkers.map((coworker) => coworker.id)).toEqual(["cw-pinned", "cw-older"]);
    expect(coworkers[0]).toEqual(
      expect.objectContaining({
        lastRunStatus: "running",
        toolAccessMode: "selected",
        allowedIntegrations: [],
        allowedWorkspaceMcpServerIds: [],
        allowedSkillSlugs: [],
        schedule: null,
      }),
    );
    expect(coworkers[0]?.recentRuns.map((run) => run.id)).toEqual(["run-newer", "run-older"]);
  });

  it("maps run lists without exposing raw error or trigger payload fields", () => {
    expect(
      mapZeroCoworkerRun({
        id: "run-1",
        coworkerId: "cw-1",
        status: "completed",
        conversationId: "chat-1",
        generationId: "gen-1",
        startedAt: 1781130000000,
        finishedAt: 1781130300000,
      }),
    ).toEqual({
      id: "run-1",
      coworkerId: "cw-1",
      status: "completed",
      conversationId: "chat-1",
      generationId: "gen-1",
      startedAt: new Date(1781130000000),
      finishedAt: new Date(1781130300000),
      errorMessage: null,
      source: "manual",
    });
  });

  it("maps folders into existing hook shapes", () => {
    expect(
      mapZeroCoworkerFolders([
        {
          id: "folder-1",
          workspaceId: "ws-1",
          ownerId: "user-1",
          parentId: null,
          name: "Team",
          visibility: "private",
          position: 2,
          createdAt: 1781130000000,
          updatedAt: 1781130100000,
        },
      ]),
    ).toEqual([
      {
        id: "folder-1",
        workspaceId: "ws-1",
        ownerId: "user-1",
        parentId: null,
        name: "Team",
        visibility: "private",
        position: 2,
        createdAt: new Date(1781130000000),
        updatedAt: new Date(1781130100000),
      },
    ]);
  });
});
