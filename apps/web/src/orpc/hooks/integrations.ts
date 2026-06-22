import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

export function useIntegrationList() {
  return useQuery({
    queryKey: ["integration", "list"],
    queryFn: () => client.integration.list(),
  });
}

export function useAccountLabels() {
  return useQuery({
    queryKey: ["integration", "account-labels"],
    queryFn: () => client.integration.listAccountLabels(),
  });
}

export function useRenameAccountLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, accountLabel }: { id: string; accountLabel: string }) =>
      client.integration.renameAccountLabel({ id, accountLabel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

export function useMoveConnectedAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      connectedAccountId: string;
      destinationConnectedIdentityId?: string;
      destinationAccountLabel?: string;
    }) => client.integration.moveConnectedAccount(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

export function useGoogleAccessStatus() {
  return useQuery({
    queryKey: ["integration", "google-access-status"],
    queryFn: () => client.integration.getGoogleAccessStatus(),
  });
}

export function useGalienStatus() {
  return useQuery({
    queryKey: ["galien", "status"],
    queryFn: () => client.galien.status(),
  });
}

export function useConnectGalien() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { username: string; password: string }) => client.galien.connect(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useDisconnectGalien() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.galien.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

type ModulrConnectionInput = {
  database: string;
  clientId: string;
  clientSecret: string;
  locale: "fr" | "en";
  baseUrl: string;
};

export function useModulrStatus() {
  return useQuery({
    queryKey: ["modulr", "status"],
    queryFn: () => client.modulr.status(),
  });
}

export function useTestModulrConnection() {
  return useMutation({
    mutationFn: (input: ModulrConnectionInput) => client.modulr.test(input),
  });
}

export function useConnectModulr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ModulrConnectionInput) => client.modulr.connect(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modulr", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useDisconnectModulr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.modulr.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modulr", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useAdminModulrAccess(workspaceId: string | null) {
  return useQuery({
    queryKey: ["modulr", "admin-access", workspaceId],
    queryFn: () => client.modulr.adminListAccess({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

export function useAdminAddModulrAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; email: string }) =>
      client.modulr.adminAddAccess(input),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["modulr", "admin-access", input.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["modulr", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useAdminRemoveModulrAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; workspaceId: string }) =>
      client.modulr.adminRemoveAccess({ id: input.id }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["modulr", "admin-access", input.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["modulr", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useAdminGalienAccess(workspaceId: string | null) {
  return useQuery({
    queryKey: ["galien", "admin-access", workspaceId],
    queryFn: () => client.galien.adminListAccess({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

export function useAdminAddGalienAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; email: string; targetEnv?: "prod" | "preprod" }) =>
      client.galien.adminAddAccess(input),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["galien", "admin-access", input.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useAdminUpdateGalienAccessTargetEnv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; workspaceId: string; targetEnv: "prod" | "preprod" }) =>
      client.galien.adminUpdateAccessTargetEnv({ id: input.id, targetEnv: input.targetEnv }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["galien", "admin-access", input.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useAdminRemoveGalienAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; workspaceId: string }) =>
      client.galien.adminRemoveAccess({ id: input.id }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["galien", "admin-access", input.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceMcpServer"] });
    },
  });
}

export function useApprovedLoginEmailAllowlist() {
  return useQuery({
    queryKey: ["integration", "approved-login-email-allowlist"],
    queryFn: () => client.integration.listApprovedLoginEmailAllowlist(),
  });
}

export function useAddApprovedLoginEmailAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email }: { email: string }) =>
      client.integration.addApprovedLoginEmailAllowlistEntry({ email }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "approved-login-email-allowlist"],
      });
    },
  });
}

export function useRemoveApprovedLoginEmailAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      client.integration.removeApprovedLoginEmailAllowlistEntry({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "approved-login-email-allowlist"],
      });
    },
  });
}

export function useGoogleAccessAllowlist() {
  return useQuery({
    queryKey: ["integration", "google-access-allowlist"],
    queryFn: () => client.integration.listGoogleAccessAllowlist(),
  });
}

export function useAddGoogleAccessAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email }: { email: string }) =>
      client.integration.addGoogleAccessAllowlistEntry({ email }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-allowlist"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-status"],
      });
    },
  });
}

export function useRemoveGoogleAccessAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      client.integration.removeGoogleAccessAllowlistEntry({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-allowlist"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-status"],
      });
    },
  });
}

export function useRequestGoogleAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      integration,
      source,
    }: {
      integration?:
        | "google_gmail"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "google_drive";
      source?: "integrations" | "chat" | "onboarding";
    }) => client.integration.requestGoogleAccess({ integration, source }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-status"],
      });
    },
  });
}

// Hook for toggling integration
export function useToggleIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      client.integration.toggle({ id, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for disconnecting integration
export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.integration.disconnect({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for getting OAuth URL
export function useGetAuthUrl() {
  return useMutation({
    mutationFn: ({
      type,
      redirectUrl,
      mode,
      accountLabel,
      connectedAccountId,
    }: {
      type:
        | "google_gmail"
        | "outlook"
        | "outlook_calendar"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "google_drive"
        | "notion"
        | "github"
        | "airtable"
        | "slack"
        | "hubspot"
        | "linkedin"
        | "salesforce"
        | "dynamics";
      redirectUrl: string;
      mode?: "connect" | "connect_to_label" | "reauth";
      accountLabel?: string;
      connectedAccountId?: string;
    }) =>
      client.integration.getAuthUrl({
        type,
        redirectUrl,
        mode,
        accountLabel,
        connectedAccountId,
      }),
  });
}

// Hook for linking LinkedIn account after redirect
export function useLinkLinkedIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => client.integration.linkLinkedIn({ accountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}
