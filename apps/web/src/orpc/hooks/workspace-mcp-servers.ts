import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

// ========== WORKSPACE MCP SERVER HOOKS ==========

export function useWorkspaceMcpServerList() {
  return useQuery({
    queryKey: ["workspaceMcpServer", "list"],
    queryFn: () => client.workspaceMcpServer.list(),
  });
}

export function useCreateWorkspaceMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      kind: "mcp";
      name: string;
      namespace: string;
      endpoint: string;
      specUrl?: string | null;
      transport?: string | null;
      headers?: Record<string, string>;
      queryParams?: Record<string, string>;
      defaultHeaders?: Record<string, string>;
      authType?: "none" | "api_key" | "bearer" | "oauth2";
      authHeaderName?: string | null;
      authQueryParam?: string | null;
      authPrefix?: string | null;
      enabled?: boolean;
    }) => client.workspaceMcpServer.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useUpdateWorkspaceMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      kind: "mcp";
      name: string;
      namespace: string;
      endpoint: string;
      specUrl?: string | null;
      transport?: string | null;
      headers?: Record<string, string>;
      queryParams?: Record<string, string>;
      defaultHeaders?: Record<string, string>;
      authType?: "none" | "api_key" | "bearer" | "oauth2";
      authHeaderName?: string | null;
      authQueryParam?: string | null;
      authPrefix?: string | null;
      enabled?: boolean;
    }) => client.workspaceMcpServer.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useDeleteWorkspaceMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.workspaceMcpServer.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useStartWorkspaceMcpServerOAuth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceMcpServerId: string; redirectUrl: string }) =>
      client.workspaceMcpServer.startOAuth(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useSetWorkspaceMcpServerCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      workspaceMcpServerId: string;
      secret: string;
      displayName?: string | null;
      expiresAt?: string | null;
      enabled?: boolean;
    }) => client.workspaceMcpServer.setCredential(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useDisconnectWorkspaceMcpServerCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceMcpServerId: string) =>
      client.workspaceMcpServer.disconnectCredential({ workspaceMcpServerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}
