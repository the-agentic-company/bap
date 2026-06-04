import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

// ========== PROVIDER AUTH HOOKS ==========

type SubscriptionProvider = "openai" | "google" | "kimi";
type OAuthSubscriptionProvider = "openai" | "google";

// Hook for getting connected subscription providers status
export function useProviderAuthStatus() {
  return useQuery({
    queryKey: ["providerAuth", "status"],
    queryFn: () => client.providerAuth.status(),
  });
}

export function useAdminSharedProviderAuthStatus() {
  return useQuery({
    queryKey: ["adminSharedProviderAuth", "status"],
    queryFn: () => client.adminSharedProviderAuth.status(),
  });
}

// Hook for fetching free models available on OpenCode Zen
export function useOpencodeFreeModels() {
  return useQuery({
    queryKey: ["providerAuth", "freeModels"],
    queryFn: () => client.providerAuth.freeModels(),
    staleTime: 5 * 60 * 1000,
  });
}

// Hook for initiating subscription provider OAuth connection
export function useConnectProvider() {
  return useMutation({
    mutationFn: (provider: OAuthSubscriptionProvider) => client.providerAuth.connect({ provider }),
  });
}

export function usePollProviderConnection() {
  return useMutation({
    mutationFn: ({ provider, flowId }: { provider: "openai"; flowId: string }) =>
      client.providerAuth.poll({ provider, flowId }),
  });
}

export function useConnectAdminSharedProvider() {
  return useMutation({
    mutationFn: (provider: "openai") => client.adminSharedProviderAuth.connect({ provider }),
  });
}

export function usePollAdminSharedProviderConnection() {
  return useMutation({
    mutationFn: ({ provider, flowId }: { provider: "openai"; flowId: string }) =>
      client.adminSharedProviderAuth.poll({ provider, flowId }),
  });
}

// Hook for disconnecting a subscription provider
export function useDisconnectProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: SubscriptionProvider) => client.providerAuth.disconnect({ provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
}

export function useDisconnectAdminSharedProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: "openai" | "google") =>
      client.adminSharedProviderAuth.disconnect({ provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSharedProviderAuth"] });
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
}

export function useSetAdminSharedProviderApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: "google"; apiKey: string }) =>
      client.adminSharedProviderAuth.setApiKey({ provider, apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSharedProviderAuth"] });
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
} // ========== GENERATION HOOKS ==========
