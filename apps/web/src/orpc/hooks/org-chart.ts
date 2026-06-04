import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

export function useOrgChartNodes() {
  return useQuery({
    queryKey: ["orgChart", "list"],
    queryFn: () => client.orgChart.list(),
  });
}

export function useCreateOrgChartNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      type: "coworker" | "label";
      coworkerId?: string;
      label?: string;
      positionX: number;
      positionY: number;
    }) => client.orgChart.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgChart"] });
    },
  });
}

export function useUpdateOrgChartNodePosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; positionX: number; positionY: number }) =>
      client.orgChart.updatePosition(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["orgChart", "list"] });
      const previous = queryClient.getQueryData<
        Array<{ id: string; positionX: number; positionY: number }>
      >(["orgChart", "list"]);
      if (previous) {
        queryClient.setQueryData(
          ["orgChart", "list"],
          previous.map((n) =>
            n.id === input.id
              ? { ...n, positionX: input.positionX, positionY: input.positionY }
              : n,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["orgChart", "list"], ctx.previous);
      }
    },
  });
}

export function useUpdateOrgChartLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string }) => client.orgChart.updateLabel(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgChart"] });
    },
  });
}

export function useDeleteOrgChartNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => client.orgChart.delete(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgChart"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin sandbox hooks
// ---------------------------------------------------------------------------
