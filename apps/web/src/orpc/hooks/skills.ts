import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";
import { uploadFileAsset } from "./file-assets";

function encodeRpcContent(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

// ========== SKILL HOOKS ==========

// Hook for listing skills
export function useSkillList() {
  return useQuery({
    queryKey: ["skill", "list"],
    queryFn: () => client.skill.list(),
  });
}

// Hook for getting a single skill
export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: ["skill", "get", id],
    queryFn: () => client.skill.get({ id: id! }),
    enabled: !!id,
  });
}

// Hook for creating a skill
export function useCreateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ displayName, description }: { displayName: string; description: string }) =>
      client.skill.create({ displayName, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useImportSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      input:
        | {
            mode: "zip";
            filename: string;
            contentBase64: string;
          }
        | {
            mode: "folder";
            files: Array<{
              path: string;
              mimeType?: string;
              contentBase64: string;
            }>;
          },
    ) => client.skill.import(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for updating a skill
export function useUpdateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      name,
      displayName,
      description,
      icon,
      enabled,
    }: {
      id: string;
      name?: string;
      displayName?: string;
      description?: string;
      icon?: string | null;
      enabled?: boolean;
    }) =>
      client.skill.update({
        id,
        name,
        displayName,
        description,
        icon,
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for deleting a skill
export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
    mutationFn: (id: string) => client.skill.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useShareSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.share({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useUnshareSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.unshare({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useSaveSharedSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceSkillId: string) => client.skill.saveShared({ sourceSkillId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for adding a file to a skill
export function useAddSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ skillId, path, content }: { skillId: string; path: string; content: string }) =>
      client.skill.addFile({ skillId, path, contentBase64: encodeRpcContent(content) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for updating a file
export function useUpdateSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      client.skill.updateFile({ id, contentBase64: encodeRpcContent(content) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useDeleteSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.deleteFile({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// ========== SKILL DOCUMENT HOOKS ==========

// Hook for uploading a document
export function useUploadSkillDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { skillId: string; file: File; description?: string }) => {
      const asset = await uploadFileAsset(input.file);
      return await client.skill.uploadDocument({
        skillId: input.skillId,
        filename: asset.filename,
        mimeType: asset.mimeType,
        fileAssetId: asset.id,
        description: input.description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for getting document download URL
export function useGetDocumentUrl() {
  return useMutation({
    mutationFn: (id: string) => client.skill.getDocumentUrl({ id }),
  });
}

// Hook for deleting a document
export function useDeleteSkillDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.deleteDocument({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function usePlatformSkillList() {
  return useQuery({
    queryKey: ["generation", "platformSkills"],
    queryFn: () => client.generation.listPlatformSkills(),
    staleTime: 5 * 60 * 1000,
  });
}
