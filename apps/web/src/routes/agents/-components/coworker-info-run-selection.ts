export type CoworkerRunIdentity = {
  id: string;
  executionUserId?: string | null;
  initiatedByUserId?: string | null;
  runner?: { id: string } | null;
};

export function isCoworkerRunForUser(run: CoworkerRunIdentity, userId: string | null | undefined) {
  if (!userId) {
    return false;
  }

  return (
    run.executionUserId === userId || run.initiatedByUserId === userId || run.runner?.id === userId
  );
}

export function selectDefaultCoworkerRunId(
  runs: readonly CoworkerRunIdentity[],
  requestedRunId: string | null,
  currentUserId: string | null | undefined,
) {
  if (requestedRunId && runs.some((run) => run.id === requestedRunId)) {
    return requestedRunId;
  }

  return runs.find((run) => isCoworkerRunForUser(run, currentUserId))?.id;
}
