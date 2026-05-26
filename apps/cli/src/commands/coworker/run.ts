import type { LocalContext } from "../../context";
import { parseChaosDurationMs } from "../chat/chaos";
import { formatConversationTranscript, getCoworkerRunner, parsePayload } from "./shared";

type RunFlags = {
  server?: string;
  payload?: string;
  watch?: boolean;
  "watch-interval"?: number;
  chaosRunDeadline?: string;
  json?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printRunLogs(
  stdout: NodeJS.WriteStream,
  runner: Awaited<ReturnType<typeof getCoworkerRunner>>["runner"],
  client: Awaited<ReturnType<typeof getCoworkerRunner>>["client"],
  runId: string,
  watch: boolean,
  watchIntervalSeconds: number,
): Promise<void> {
  const seenEventIds = new Set<string>();
  let lastTranscript = "";
  let previousStatus = "";

  while (true) {
    const run = await runner.logs(runId);

    if (run.status !== previousStatus) {
      stdout.write(`Run ${run.id} ${run.status}\n`);
      stdout.write(`  coworker: ${run.coworkerId}\n`);
      stdout.write(`  started: ${new Date(run.startedAt).toLocaleString()}\n`);
      if (run.finishedAt) {
        stdout.write(`  finished: ${new Date(run.finishedAt).toLocaleString()}\n`);
      }
      if (run.errorMessage) {
        stdout.write(`  error: ${run.errorMessage}\n`);
      }
      stdout.write("\n");
      previousStatus = run.status;
    }

    const unseenEvents = run.events.filter((event) => !seenEventIds.has(event.id));
    if (unseenEvents.length > 0) {
      stdout.write(`Events (${unseenEvents.length} new):\n`);
      for (const event of unseenEvents) {
        seenEventIds.add(event.id);
        stdout.write(`- ${new Date(event.createdAt).toLocaleString()} [${event.type}]\n`);
        stdout.write(`  ${JSON.stringify(event.payload, null, 2).replace(/\n/g, "\n  ")}\n`);
      }
      stdout.write("\n");
    }

    if (run.conversationId) {
      const conversation = await client.conversation.get({ id: run.conversationId });
      const transcript = formatConversationTranscript(conversation.messages);
      if (transcript && transcript !== lastTranscript) {
        stdout.write(lastTranscript ? "Updated transcript:\n" : "Transcript:\n");
        stdout.write(`${transcript}\n\n`);
        lastTranscript = transcript;
      }
    }

    if (!watch || ["completed", "cancelled", "error", "success", "failed"].includes(run.status)) {
      return;
    }

    await sleep(watchIntervalSeconds * 1000);
  }
}

export default async function (
  this: LocalContext,
  flags: RunFlags,
  reference: string,
): Promise<void> {
  const { runner, client } = await getCoworkerRunner({ server: flags.server });
  const debugRunDeadlineMs = flags.chaosRunDeadline
    ? parseChaosDurationMs(flags.chaosRunDeadline)
    : undefined;
  const result = await runner.run(reference, parsePayload(flags.payload), {
    debugRunDeadlineMs,
  });

  if (flags.json) {
    this.process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  this.process.stdout.write(`Triggered coworker ${result.coworkerId}\n`);
  this.process.stdout.write(`  run id: ${result.runId}\n`);
  this.process.stdout.write(`  generation id: ${result.generationId}\n`);
  this.process.stdout.write(`  conversation id: ${result.conversationId}\n`);

  if (flags.watch) {
    this.process.stdout.write("\nWatching logs... (Ctrl+C to stop)\n\n");
    await printRunLogs(
      this.process.stdout,
      runner,
      client,
      result.runId,
      true,
      flags["watch-interval"] ?? 2,
    );
  }
}
