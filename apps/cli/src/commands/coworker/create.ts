import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import type { LocalContext } from "../../context";
import { getCoworkerRunner, splitCsv } from "./shared";

type CreateFlags = {
  server?: string;
  name?: string;
  trigger: string;
  prompt: string;
  promptDo?: string;
  promptDont?: string;
  folder?: string;
  autoApprove?: boolean;
  model?: string;
  authSource?: "user" | "shared";
  integrations?: string;
  json?: boolean;
};

export default async function (this: LocalContext, flags: CreateFlags): Promise<void> {
  const { client, runner } = await getCoworkerRunner({ server: flags.server });
  const allowedIntegrations = splitCsv(flags.integrations);
  const created = await runner.create({
    name: flags.name,
    triggerType: flags.trigger,
    prompt: flags.prompt,
    promptDo: flags.promptDo,
    promptDont: flags.promptDont,
    autoApprove: flags.autoApprove,
    model: flags.model ?? DEFAULT_CONNECTED_CHATGPT_MODEL,
    authSource: flags.authSource,
    toolAccessMode: allowedIntegrations.length > 0 ? "selected" : undefined,
    allowedIntegrations: allowedIntegrations.length > 0 ? allowedIntegrations : undefined,
  });

  const trimmedFolderPath = flags.folder?.trim();
  const folder = trimmedFolderPath
    ? await client.coworkerFolder.createPath({ path: trimmedFolderPath })
    : null;
  if (folder) {
    await client.coworkerFolder.moveCoworker({
      coworkerId: created.id,
      folderId: folder.id,
    });
  }

  if (flags.json) {
    this.process.stdout.write(
      `${JSON.stringify({ ...created, folder: folder ?? undefined }, null, 2)}\n`,
    );
    return;
  }

  this.process.stdout.write("Created coworker:\n");
  this.process.stdout.write(`  id: ${created.id}\n`);
  this.process.stdout.write(`  name: ${created.name || "(unnamed)"}\n`);
  this.process.stdout.write(`  username: ${created.username ?? "-"}\n`);
  this.process.stdout.write(`  folder: ${folder ? trimmedFolderPath : "-"}\n`);
  this.process.stdout.write(`  status: ${created.status}\n`);
}
