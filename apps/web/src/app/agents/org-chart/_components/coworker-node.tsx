"use client";

import { type NodeProps, type Node } from "@xyflow/react";
import { X } from "lucide-react";
import { useCallback } from "react";
import {
  InteractiveCoworkerCard,
  type InteractiveCoworkerCardData,
} from "@/components/coworkers/interactive-coworker-card";
import { cn } from "@/lib/utils";
import { useDeleteOrgChartNode } from "@/orpc/hooks";

export type CoworkerNodeData = InteractiveCoworkerCardData & {
  coworkerId: string;
};

export type CoworkerNodeType = Node<CoworkerNodeData, "coworker">;

export function CoworkerNode({ data, id, selected }: NodeProps<CoworkerNodeType>) {
  const deleteNode = useDeleteOrgChartNode();

  const handleDelete = useCallback(() => {
    deleteNode.mutate({ id });
  }, [deleteNode, id]);

  return (
    <div className="group/node relative p-1">
      <div className="h-[260px] w-[380px] overflow-hidden rounded-xl">
        <InteractiveCoworkerCard coworker={data} className="hover:bg-card h-full w-full" />
      </div>
      <button
        type="button"
        onClick={handleDelete}
        className={cn(
          "absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full transition-all duration-150",
          "bg-foreground/80 text-background hover:bg-destructive",
          selected
            ? "scale-100 opacity-100"
            : "scale-90 opacity-0 group-hover/node:scale-100 group-hover/node:opacity-100",
        )}
      >
        <X className="size-2.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
