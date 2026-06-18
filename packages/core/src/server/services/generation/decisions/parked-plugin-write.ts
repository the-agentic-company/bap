import type { RuntimeToolRef } from "../../../runtime/runtime-driver";
import { buildRuntimeEnvSourcedCommand } from "../../../execution/runtime-env";
import type { SandboxBackend } from "../../../sandbox/types";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import type { ParkedPluginWriteApplicationResult } from "./decision-shared";

type ParkedPluginWriteExecution =
  | { status: "completed"; output: string }
  | { status: "error"; error: string; outputForStream: unknown };

const CONTINUATION_TEXT =
  "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.";

type UpdateRuntimeToolPart = (
  runtimeClient: unknown,
  runtimeTool: RuntimeToolRef,
  patch:
    | { status: "completed"; input: Record<string, unknown>; output: string }
    | { status: "error"; input: Record<string, unknown>; error: string },
) => Promise<void>;

export async function applyParkedPluginWrite(
  deps: { updateRuntimeToolPart?: UpdateRuntimeToolPart },
  input: {
    interrupt: GenerationInterruptRecord;
    sandbox?: SandboxBackend;
    runtimeClient: unknown;
    runtimeTool: RuntimeToolRef;
  },
): Promise<ParkedPluginWriteApplicationResult> {
  const execution = await executeApprovedParkedPluginWriteCommand({
    interrupt: input.interrupt,
    sandbox: input.sandbox,
  });
  const toolInput =
    input.interrupt.display.toolInput && typeof input.interrupt.display.toolInput === "object"
      ? (input.interrupt.display.toolInput as Record<string, unknown>)
      : input.runtimeTool.input;

  if (execution.status === "completed") {
    await deps.updateRuntimeToolPart?.(input.runtimeClient, input.runtimeTool, {
      status: "completed",
      input: toolInput,
      output: execution.output,
    });
    await generationInterruptService.markInterruptApplied(input.interrupt.id);
    return {
      toolUseId: input.runtimeTool.callId,
      toolName: input.runtimeTool.toolName,
      result: execution.output,
      continuationText: CONTINUATION_TEXT,
    };
  }

  await deps.updateRuntimeToolPart?.(input.runtimeClient, input.runtimeTool, {
    status: "error",
    input: toolInput,
    error: execution.error,
  });
  await generationInterruptService.markInterruptApplied(input.interrupt.id);
  return {
    toolUseId: input.runtimeTool.callId,
    toolName: input.runtimeTool.toolName,
    result: execution.outputForStream,
    continuationText: CONTINUATION_TEXT,
  };
}

async function executeApprovedParkedPluginWriteCommand(input: {
  interrupt: GenerationInterruptRecord;
  sandbox?: SandboxBackend;
}): Promise<ParkedPluginWriteExecution> {
  if (input.interrupt.status !== "accepted") {
    const error = "User denied this integration write.";
    return { status: "error", error, outputForStream: { error } };
  }
  if (!input.sandbox) {
    const error =
      "Approved integration write could not run because the sandbox was not attached.";
    return { status: "error", error, outputForStream: { error } };
  }

  const command = input.interrupt.display.command;
  if (!command) {
    const error =
      "Approved integration write could not run because the saved command is missing.";
    return { status: "error", error, outputForStream: { error } };
  }
  const toolInput =
    input.interrupt.display.toolInput && typeof input.interrupt.display.toolInput === "object"
      ? (input.interrupt.display.toolInput as Record<string, unknown>)
      : {};
  const workdir = typeof toolInput.workdir === "string" ? toolInput.workdir : undefined;
  const result = await input.sandbox.execute(
    buildRuntimeEnvSourcedCommand({ command, workdir }),
    {
      timeout: 120_000,
    },
  );
  if (result.exitCode !== 0) {
    const errorText =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `Approved command exited with status ${result.exitCode}`;
    return {
      status: "error",
      error: errorText,
      outputForStream: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  }

  return {
    status: "completed",
    output: result.stdout,
  };
}
