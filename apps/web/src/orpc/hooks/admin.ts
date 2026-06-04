import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

export function useAdminTemplateCatalogList() {
  return useQuery({
    queryKey: ["template", "admin-list"],
    queryFn: () => client.template.list(),
  });
}

export function useAdminExportTemplateCatalog() {
  return useMutation({
    mutationFn: () => client.template.exportCatalog({}),
  });
}

export function useAdminImportTemplateCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ definitionJson }: { definitionJson: string }) =>
      client.template.importCatalog({ definitionJson }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template", "admin-list"] });
    },
  });
}

export function useAdminDeleteTemplateCatalogEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) => client.template.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template", "admin-list"] });
    },
  });
}

export function useAdminSetTemplateCatalogFeatured() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      client.template.setFeatured({ id, featured }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template", "admin-list"] });
    },
  });
}

export function useChatOverview() {
  return useQuery({
    queryKey: ["admin", "chatOverview"],
    queryFn: () => client.admin.getChatOverview(),
    refetchInterval: 60_000,
  });
}

export function useAdminUsageDashboard(workspaceId: string | null) {
  return useQuery({
    queryKey: ["admin", "usageDashboard", workspaceId],
    queryFn: () =>
      client.admin.getUsageDashboard(workspaceId === "all" ? {} : { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
    refetchInterval: 120_000,
  });
}

export function useAdminCoworkerOverview(workspaceId: string | null) {
  return useQuery({
    queryKey: ["admin", "coworkerOverview", workspaceId],
    queryFn: () =>
      client.admin.getCoworkerOverview(workspaceId === "all" ? {} : { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
  });
}

export function usePerformanceDashboard(days: "1" | "7" | "30" = "7") {
  return useQuery({
    queryKey: ["admin", "performanceDashboard", days],
    queryFn: () => client.admin.getPerformanceDashboard({ days }),
    refetchInterval: 120_000,
  });
}

export function useAdminOpsScheduledCoworkers() {
  return useQuery({
    queryKey: ["admin", "ops", "scheduledCoworkers"],
    queryFn: () => client.admin.getOpsScheduledCoworkers(),
    refetchInterval: 15_000,
  });
}

export function useEnqueueAdminScheduledCoworkersNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[] }) => client.admin.enqueueScheduledCoworkersNow(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "ops", "scheduledCoworkers"],
      });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useSetUserAdminRole() {
  return useMutation({
    mutationFn: (input: { userId: string; isAdmin: boolean }) =>
      client.admin.setUserAdminRole(input),
  });
}

export function useGrantAdminAccessByEmail() {
  return useMutation({
    mutationFn: (input: { email: string }) => client.admin.grantAdminAccessByEmail(input),
  });
}

// ---------------------------------------------------------------------------
// Org Chart
// ---------------------------------------------------------------------------

export function useAdminListSandboxes() {
  return useQuery({
    queryKey: ["admin", "sandboxes"],
    queryFn: () => client.admin.listSandboxes(),
    refetchInterval: 15_000,
  });
}

export function useAdminKillSandbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sandboxId: string; provider: "e2b" | "daytona" }) =>
      client.admin.killSandbox(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "sandboxes"] });
    },
  });
}

export function useAdminSandboxUsageHistory(input: {
  range: "24h" | "7d" | "30d";
  bucket: "hour" | "day";
}) {
  return useQuery({
    queryKey: ["admin", "sandboxes", "usage", input.range, input.bucket],
    queryFn: () => client.admin.getSandboxUsageHistory(input),
    refetchInterval: 60_000,
  });
}
