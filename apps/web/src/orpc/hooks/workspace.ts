import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

export function useAdminWorkspaces() {
  return useQuery({
    queryKey: ["billing", "admin-workspaces"],
    queryFn: () => client.billing.adminWorkspaces(),
  });
}

export function useAdminJoinWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string }) => client.billing.adminJoinWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

export function useAdminAddWorkspaceMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; emails: string[] }) =>
      client.billing.adminAddWorkspaceMembers(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminRemoveWorkspaceMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; email: string }) =>
      client.billing.adminRemoveWorkspaceMember(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; ownerEmail: string }) =>
      client.billing.adminCreateWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminRenameWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; name: string }) =>
      client.billing.adminRenameWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useInviteWorkspaceMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; emails: string[]; role?: "admin" | "member" }) =>
      client.billing.inviteMembers(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "members"] });
    },
  });
}

export function useWorkspaceMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["billing", "members", workspaceId],
    queryFn: () => client.billing.members({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

export function useRenameWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; name: string }) => client.billing.rename(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "members"] });
    },
  });
}
