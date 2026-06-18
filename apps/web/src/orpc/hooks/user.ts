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
type UserImageMutationResult = {
  image: string | null;
};

function updateUserImageCache(
  queryClient: ReturnType<typeof useQueryClient>,
  result: UserImageMutationResult | undefined,
) {
  if (!result) {
    return;
  }

  queryClient.setQueryData<CurrentUser>(["user", "me"], (currentUser) =>
    currentUser ? Object.assign({}, currentUser, { image: result.image }) : currentUser,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("bap:user-image-updated", {
        detail: { image: result.image },
      }),
    );
  }
}

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

export function useUpdateUserImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      contentBase64: string;
      mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
    }) => client.user.updateImage(input),
    onSuccess: (result) => {
      updateUserImageCache(queryClient, result);
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useRemoveUserImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.user.removeImage(),
    onSuccess: (result) => {
      updateUserImageCache(queryClient, result);
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}
