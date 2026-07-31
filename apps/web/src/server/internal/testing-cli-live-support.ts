import { getQueue, queueName } from "@bap/core/server/queues";

export function uniqueNonEmpty(values: Iterable<string> | undefined): string[] {
  return Array.from(new Set(Array.from(values ?? []).filter((value) => value.trim().length > 0)));
}

export async function getWorkerQueueReadiness(): Promise<{
  ready: boolean;
  queueName: string;
  workerCount: number;
  counts: Record<string, number>;
}> {
  const queue = getQueue();
  const [workerCount, counts] = await Promise.all([
    queue.getWorkersCount(),
    queue.getJobCounts("waiting", "active", "delayed", "failed", "paused"),
  ]);

  return {
    ready: workerCount > 0,
    queueName,
    workerCount,
    counts,
  };
}
