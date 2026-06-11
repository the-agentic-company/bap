export function buildZeroStorageKey(params: { userId: string; workspaceId: string }): string {
  return `cmdclaw-web:${params.userId}:${params.workspaceId}`;
}
