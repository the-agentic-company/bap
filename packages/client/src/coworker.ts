import type {
  BapApiClient,
  CoworkerCreateInput,
  CoworkerCreateResult,
  CoworkerDetails,
  FileAttachmentInput,
  CoworkerRun,
  CoworkerRunSummary,
  CoworkerSummary,
  CoworkerTriggerResult,
} from "./types";

export function isCoworkerUsernameReference(value: string): boolean {
  return value.trim().startsWith("@");
}

export async function resolveCoworkerReference(
  client: BapApiClient,
  reference: string,
): Promise<string> {
  const trimmed = reference.trim();
  if (!trimmed) {
    throw new Error("Coworker reference cannot be empty.");
  }

  if (!isCoworkerUsernameReference(trimmed)) {
    return trimmed;
  }

  const username = trimmed.slice(1).trim().toLowerCase();
  if (!username) {
    throw new Error("Coworker username cannot be empty.");
  }

  const coworkers = await client.coworker.list();
  const matched = coworkers.find((coworker) => coworker.username === username);
  if (!matched) {
    throw new Error(`Coworker @${username} not found.`);
  }

  return matched.id;
}

export function createCoworkerRunner(client: BapApiClient) {
  return {
    async resolveReference(reference: string): Promise<string> {
      return resolveCoworkerReference(client, reference);
    },
    async list(): Promise<CoworkerSummary[]> {
      return client.coworker.list();
    },
    async get(reference: string): Promise<CoworkerDetails> {
      const id = await resolveCoworkerReference(client, reference);
      return client.coworker.get({ id });
    },
    async create(input: CoworkerCreateInput): Promise<CoworkerCreateResult> {
      return client.coworker.create(input);
    },
    async run(
      reference: string,
      payload?: unknown,
      options?: {
        trustedUserInput?: string;
        debugRunDeadlineMs?: number;
        fileAttachments?: FileAttachmentInput[];
      },
    ): Promise<CoworkerTriggerResult> {
      const id = await resolveCoworkerReference(client, reference);
      return client.coworker.trigger({
        id,
        payload,
        trustedUserInput: options?.trustedUserInput,
        debugRunDeadlineMs: options?.debugRunDeadlineMs,
        fileAttachments: options?.fileAttachments,
      });
    },
    async logs(runId: string): Promise<CoworkerRun> {
      return client.coworker.getRun({ id: runId });
    },
    async listRuns(reference: string, limit = 20): Promise<CoworkerRunSummary[]> {
      const id = await resolveCoworkerReference(client, reference);
      return client.coworker.listRuns({ coworkerId: id, limit });
    },
  };
}
