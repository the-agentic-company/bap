export type CoworkerConfiguration = Record<string, unknown>;
export type CoworkerConfigurationPatch = Record<string, unknown>;

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function listChangedCoworkerFields(
  before: CoworkerConfiguration,
  after: CoworkerConfiguration,
): string[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(fields)
    .filter((field) => !structurallyEqual(before[field], after[field]))
    .sort();
}

export function findCoworkerRevisionConflicts(input: {
  patchFields: readonly string[];
  interveningRevisions: ReadonlyArray<{ changedFields: readonly string[] }>;
}): string[] {
  const changedSinceBase = new Set(
    input.interveningRevisions.flatMap((revision) => revision.changedFields),
  );
  return Array.from(new Set(input.patchFields.filter((field) => changedSinceBase.has(field)))).sort();
}

export function mergeCoworkerConfigurationPatch<T extends CoworkerConfiguration>(
  current: T,
  patch: CoworkerConfigurationPatch,
): T {
  return { ...current, ...patch };
}
