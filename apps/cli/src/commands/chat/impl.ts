import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { parseModelReference } from "@bap/core/lib/model-reference";
import { defaultProfileStore } from "@bap/client";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type readline from "node:readline";
import type { LocalContext } from "../../context";
import { ensureAuthenticatedClient } from "../../lib/auth";
import {
  formatModelSelection,
  parseInteractiveModelCommand,
  resolveCliModelSelection,
} from "../../lib/chat-model-source";
import { resolveServerUrl } from "../../lib/client";
import { parseChaosDurationMs } from "./chaos";
import { ask, createPrompt } from "./chat-interrupts";
import {
  hydrateProviderAvailability,
  printAuthenticatedUserDeferred,
  printAvailableModels,
} from "./chat-providers";
import {
  isAttachableGenerationStatus,
  runOneGeneration,
  shouldAutoResumePausedRunDeadline,
} from "./chat-generation-runner";
import type { ActiveConversationGeneration, ChatState } from "./chat-types";

// Re-exported so `./impl` remains the import site for these marker helpers and
// the auto-resume predicate (see impl.test.ts).
export {
  hasCompleteRuntimeMetadata,
  printRuntimeMetadata,
  shouldPrintRuntimeMetadata,
} from "./chat-output-markers";
export { shouldAutoResumePausedRunDeadline } from "./chat-generation-runner";

type ChatFlags = {
  server?: string;
  conversation?: string;
  message?: string;
  mesage?: string;
  model?: string;
  authSource?: ProviderAuthSource;
  sandbox?: "e2b" | "daytona" | "docker";
  listModels?: boolean;
  autoApprove?: boolean;
  open?: boolean;
  chaosRunDeadline?: string;
  chaosApproval: "ask" | "defer";
  chaosApprovalParkAfter?: string;
  chaosRuntimeNoProgress?: string;
  chaosForceRuntimeNoProgress?: boolean;
  attach?: string;
  attachGeneration?: string;
  validate: boolean;
  questionAnswer?: readonly string[];
  file?: readonly string[];
  perfettoTrace?: boolean;
  timing?: boolean;
  token?: string;
};

type InternalChatFlags = ChatFlags & {
  continueAfterMessage?: boolean;
};

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
};

function fileToAttachment(filePath: string): {
  name: string;
  mimeType: string;
  dataUrl: string;
} {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const data = readFileSync(resolved);
  const base64 = data.toString("base64");
  return {
    name: basename(resolved),
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function attachSigintHandler(rl: readline.Interface): void {
  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
    process.exit(0);
  });
}

async function runChatLoop(
  stdout: NodeJS.WriteStream,
  client: Parameters<typeof runOneGeneration>[1],
  rl: readline.Interface,
  state: ChatState,
): Promise<void> {
  let conversationId = state.conversationId;
  let pendingFiles = [...state.file];
  state.file = [];

  while (true) {
    const rawInput = await ask(rl, conversationId ? "followup> " : "chat> ");
    const input = rawInput.trim();
    if (!input) {
      stdout.write("Bye.\n");
      return;
    }

    if (input.startsWith("/file ")) {
      pendingFiles.push(input.slice(6).trim());
      stdout.write(`Attached: ${basename(input.slice(6).trim())}\n`);
      continue;
    }

    if (input === "/model") {
      stdout.write(
        `Current model: ${formatModelSelection({
          model: state.model ?? "auto",
          authSource: state.authSource,
        })}\n`,
      );
      continue;
    }

    if (input.startsWith("/model ")) {
      const parsed = parseInteractiveModelCommand(input.slice(7).trim());
      parseModelReference(parsed.model);
      const resolvedSelection = resolveCliModelSelection({
        model: parsed.model,
        authSource: parsed.authSource,
        connectedProviderIds: state.connectedProviderIds,
        sharedConnectedProviderIds: state.sharedConnectedProviderIds,
      });
      state.model = resolvedSelection.model;
      state.authSource = resolvedSelection.authSource;
      stdout.write(`Switched model to: ${formatModelSelection(resolvedSelection)}\n`);
      continue;
    }

    if (input === "/models") {
      await printAvailableModels(stdout, state);
      continue;
    }

    const attachments = pendingFiles.map((file) => fileToAttachment(file));
    pendingFiles = [];

    const nextConversationId = await runOneGeneration(stdout, client, rl, state, {
      kind: "start",
      content: input,
      conversationId,
      attachments: attachments.length ? attachments : undefined,
    });
    if (!nextConversationId) {
      return;
    }
    conversationId = nextConversationId;
  }
}

export default async function (this: LocalContext, flags: ChatFlags): Promise<void> {
  const initialMessage = flags.message ?? flags.mesage;
  if (flags.message && flags.mesage) {
    throw new Error("--message and --mesage cannot both be used");
  }
  if ((flags.attach || flags.attachGeneration) && initialMessage) {
    throw new Error("--attach/--attach-generation cannot be used with --message");
  }
  if (flags.attach && flags.attachGeneration) {
    throw new Error("--attach cannot be used with --attach-generation");
  }
  const debugRunDeadlineMs = flags.chaosRunDeadline
    ? parseChaosDurationMs(flags.chaosRunDeadline)
    : undefined;
  const debugApprovalHotWaitMs = flags.chaosApprovalParkAfter
    ? parseChaosDurationMs(flags.chaosApprovalParkAfter)
    : undefined;
  const debugRuntimeNoProgressTimeoutMs = flags.chaosRuntimeNoProgress
    ? parseChaosDurationMs(flags.chaosRuntimeNoProgress)
    : undefined;

  const serverUrl = resolveServerUrl(flags.server);
  if (flags.token) {
    defaultProfileStore.save({
      serverUrl,
      token: flags.token,
    });
  }

  const { client } = await ensureAuthenticatedClient({
    serverUrl,
    token: flags.token,
  });

  const state: ChatState = {
    server: serverUrl,
    conversationId: flags.conversation,
    message: initialMessage,
    model: flags.model,
    authSource: flags.authSource,
    sandbox: flags.sandbox,
    autoApprove: flags.autoApprove,
    open: flags.open ?? false,
    chaosApproval: flags.chaosApproval,
    debugRunDeadlineMs,
    debugApprovalHotWaitMs,
    debugRuntimeNoProgressTimeoutMs,
    debugForceRuntimeNoProgressAfterPrompt:
      flags.chaosForceRuntimeNoProgress ?? false,
    validate: flags.validate,
    continueAfterMessage: (flags as InternalChatFlags).continueAfterMessage,
    file: flags.file ?? [],
    perfettoTrace: flags.perfettoTrace ?? false,
    timing: flags.timing ?? false,
    questionAnswer: flags.questionAnswer ?? [],
  };

  const authenticatedUserPromise = printAuthenticatedUserDeferred(client);
  await hydrateProviderAvailability(client, state);
  this.process.stdout.write(
    `[model] ${formatModelSelection({ model: state.model ?? "auto", authSource: state.authSource })}\n`,
  );
  this.process.stdout.write(await authenticatedUserPromise);

  if (flags.listModels) {
    await printAvailableModels(this.process.stdout, state);
    return;
  }

  if (flags.attachGeneration) {
    await runOneGeneration(this.process.stdout, client, null, state, {
      kind: "attach",
      generationId: flags.attachGeneration,
    });
    return;
  }

  if (flags.attach) {
    const active = (await client.generation.getActiveGeneration({
      conversationId: flags.attach,
    })) as ActiveConversationGeneration;
    state.conversationId = flags.attach;
    if (shouldAutoResumePausedRunDeadline(active) && active.generationId) {
      this.process.stdout.write(
        `[attach] conversation=${flags.attach} generation=${active.generationId} reason=run_deadline; sending continue\n`,
      );
      await runOneGeneration(this.process.stdout, client, null, state, {
        kind: "start",
        content: "continue",
        conversationId: flags.attach,
        resumePausedGenerationId: active.generationId,
      });
      return;
    }
    if (active.generationId && isAttachableGenerationStatus(active.status)) {
      this.process.stdout.write(
        `[attach] conversation=${flags.attach} generation=${active.generationId}\n`,
      );
      const rl = process.stdin.isTTY && process.stdout.isTTY ? createPrompt() : null;
      if (rl) {
        attachSigintHandler(rl);
      }
      try {
        await runOneGeneration(this.process.stdout, client, rl, state, {
          kind: "attach",
          generationId: active.generationId,
          suppressReplayRuntimeMetadataUntilDecision:
            active.status === "awaiting_approval" || active.status === "awaiting_auth",
        });
      } finally {
        rl?.close();
      }
      return;
    }

    this.process.stdout.write(
      active.status
        ? `[attach] conversation=${flags.attach} status=${active.status}; no active generation, opening followup prompt\n`
        : `[attach] conversation=${flags.attach}; no active generation, opening followup prompt\n`,
    );
    const rl = createPrompt();
    attachSigintHandler(rl);
    await runChatLoop(this.process.stdout, client, rl, state);
    rl.close();
    return;
  }

  if (state.message) {
    const rl =
      state.continueAfterMessage && process.stdin.isTTY && process.stdout.isTTY
        ? createPrompt()
        : null;
    if (rl) {
      attachSigintHandler(rl);
    }
    const attachments = state.file.map((file) => fileToAttachment(file));
    const conversationId = await runOneGeneration(this.process.stdout, client, rl, state, {
      kind: "start",
      content: state.message,
      conversationId: state.conversationId,
      attachments: attachments.length ? attachments : undefined,
    });
    if (conversationId && rl) {
      state.conversationId = conversationId;
      state.message = undefined;
      state.file = [];
      await runChatLoop(this.process.stdout, client, rl, state);
      rl.close();
    }
    return;
  }

  const rl = createPrompt();
  attachSigintHandler(rl);
  await runChatLoop(this.process.stdout, client, rl, state);
  rl.close();
}
