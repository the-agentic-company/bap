import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

// ========== BILLING HOOKS ==========

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => client.billing.overview(),
    enabled,
  });
}

export function useAdminBillingUserOverview(targetUserId: string | null) {
  return useQuery({
    queryKey: ["billing", "admin-user-overview", targetUserId],
    queryFn: () => client.billing.adminUserOverview({ targetUserId: targetUserId! }),
    enabled: Boolean(targetUserId),
  });
}

export function useSwitchWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string | null) => client.billing.switchWorkspace({ workspaceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useAttachBillingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      planId: "free" | "pro" | "business" | "enterprise";
      successUrl?: string;
    }) => client.billing.attachPlan(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      returnUrl?: string;
    }) => client.billing.openPortal(input),
  });
}

export function useCancelBillingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      productId: "pro" | "business" | "enterprise";
    }) => client.billing.cancelPlan(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useManualBillingTopUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      usdAmount: number;
    }) => client.billing.manualTopUp(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

export function useAdminManualBillingTopUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { targetUserId: string; usdAmount: number }) =>
      client.billing.adminManualTopUp(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-user-overview"],
      });
    },
  });
}
