import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

// ========== USER HOOKS ==========

// Hook for getting current user
export function useCurrentUser(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["user", "me"],
    queryFn: () => client.user.me(),
    enabled: options?.enabled ?? true,
  });
}

type CurrentUser = Awaited<ReturnType<typeof client.user.me>>;

// Hook for completing onboarding
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.user.completeOnboarding(),
    onSuccess: async () => {
      queryClient.setQueryData<CurrentUser>(["user", "me"], (currentUser) =>
        currentUser ? { ...currentUser, onboardedAt: new Date() } : currentUser,
      );
      await queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useResetOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.user.resetOnboarding(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });
}

export function useSetUserTimezone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (timezone: string) => client.user.setTimezone({ timezone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}
