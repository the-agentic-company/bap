import type { WorkspaceIntegrationPolicySubject } from "@bap/core/server/services/workspace-integration-policy";
import type {
  WorkspaceIntegrationOperationRestriction,
  WorkspaceIntegrationPolicyMode,
} from "@bap/integration-policy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

const queryKey = (workspaceId: string) => ["workspace-integration-policy", workspaceId] as const;

export function useWorkspaceIntegrationPolicies(workspaceId: string) {
  return useQuery({
    queryKey: queryKey(workspaceId),
    queryFn: () => client.workspaceIntegrationPolicy.list(),
    enabled: workspaceId.length > 0,
  });
}

export function useDiscoverWorkspaceMcpTools(workspaceId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...queryKey(workspaceId), "mcp-discovery"],
    queryFn: async () => {
      const result = await client.workspaceIntegrationPolicy.discover();
      await queryClient.invalidateQueries({
        queryKey: queryKey(workspaceId),
        exact: true,
      });
      return result;
    },
    enabled: workspaceId.length > 0,
    staleTime: 30_000,
  });
}

export function useReplaceWorkspaceIntegrationPolicy(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      subject: WorkspaceIntegrationPolicySubject;
      mode: WorkspaceIntegrationPolicyMode;
      restrictions: Array<{
        operationKey: string;
        restriction: WorkspaceIntegrationOperationRestriction;
      }>;
    }) => client.workspaceIntegrationPolicy.replace(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(workspaceId) }),
  });
}
