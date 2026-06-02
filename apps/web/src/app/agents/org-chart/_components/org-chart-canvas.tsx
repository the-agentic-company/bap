"use client";

import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  type Node,
  type OnNodesChange,
  useReactFlow,
} from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import
import "@xyflow/react/dist/style.css";
import { StickyNote, ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { IntegrationType } from "@/lib/integration-icons";
import { Sheet, SheetContent } from "@/components/animate-ui/components/radix/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useCreateOrgChartNode,
  useDeleteOrgChartNode,
  useUpdateOrgChartNodePosition,
} from "@/orpc/hooks";
import { CoworkerNode, type CoworkerNodeData } from "./coworker-node";
import { LabelNode, type LabelNodeData } from "./label-node";
import { UnassignedSidebarContent } from "./unassigned-sidebar";

type OrgChartNodeRecord = {
  id: string;
  type: string;
  coworkerId: string | null;
  label: string | null;
  positionX: number;
  positionY: number;
};

type CoworkerRecord = {
  id: string;
  name?: string | null;
  username?: string | null;
  description?: string | null;
  status: "on" | "off";
  triggerType: string;
  sharedAt?: Date | string | null;
  toolAccessMode?: "all" | "selected" | null;
  allowedIntegrations?: IntegrationType[];
  allowedSkillSlugs?: string[];
  recentRuns?: { id: string; status: string; startedAt?: Date | string | null }[];
};

const nodeTypes = {
  coworker: CoworkerNode,
  label: LabelNode,
};

const EMPTY_EDGES: never[] = [];

const FIT_VIEW_OPTIONS = { padding: 0.3 };

const PRO_OPTIONS = { hideAttribution: true };

function buildNodes(
  chartNodes: OrgChartNodeRecord[],
  coworkerMap: Map<string, CoworkerRecord>,
): Node[] {
  return chartNodes
    .map((n) => {
      if (n.type === "coworker" && n.coworkerId) {
        const cw = coworkerMap.get(n.coworkerId);
        if (!cw) {
          return null;
        }
        return {
          id: n.id,
          type: "coworker" as const,
          position: { x: n.positionX, y: n.positionY },
          data: {
            id: cw.id,
            coworkerId: cw.id,
            name: cw.name ?? "New Coworker",
            username: cw.username,
            description: cw.description,
            status: cw.status,
            triggerType: cw.triggerType,
            sharedAt: cw.sharedAt,
            toolAccessMode: cw.toolAccessMode,
            allowedIntegrations: cw.allowedIntegrations,
            allowedSkillSlugs: cw.allowedSkillSlugs,
            recentRuns: cw.recentRuns,
          } satisfies CoworkerNodeData,
        };
      }
      if (n.type === "label") {
        return {
          id: n.id,
          type: "label" as const,
          position: { x: n.positionX, y: n.positionY },
          data: {
            label: n.label ?? "",
            nodeId: n.id,
          } satisfies LabelNodeData,
        };
      }
      return null;
    })
    .filter(Boolean) as Node[];
}

type UnassignedCoworker = {
  id: string;
  name?: string | null;
  username?: string | null;
  status: "on" | "off";
  triggerType: string;
};

export function OrgChartCanvas({
  chartNodes,
  coworkers,
  unassignedCoworkers,
  onAddCoworker,
}: {
  chartNodes: OrgChartNodeRecord[];
  coworkers: CoworkerRecord[];
  unassignedCoworkers: UnassignedCoworker[];
  onAddCoworker: (coworkerId: string) => void;
}) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const coworkerMap = useMemo(() => new Map(coworkers.map((c) => [c.id, c])), [coworkers]);

  const initialNodes = useMemo(
    () => buildNodes(chartNodes, coworkerMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartNodes],
  );

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialNodes);
  const { screenToFlowPosition } = useReactFlow();
  const createNode = useCreateOrgChartNode();
  const updatePosition = useUpdateOrgChartNodePosition();
  const deleteNode = useDeleteOrgChartNode();

  // Sync when chartNodes changes from server
  const prevChartNodesRef = useRef(chartNodes);
  useEffect(() => {
    if (prevChartNodesRef.current !== chartNodes) {
      prevChartNodesRef.current = chartNodes;
      setNodes(buildNodes(chartNodes, coworkerMap));
    }
  }, [chartNodes, coworkerMap, setNodes]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      updatePosition.mutate({
        id: node.id,
        positionX: Math.round(node.position.x),
        positionY: Math.round(node.position.y),
      });
    },
    [updatePosition],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const coworkerId = event.dataTransfer.getData("application/cmdclaw-coworker");
      if (!coworkerId) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      createNode.mutate({
        type: "coworker",
        coworkerId,
        positionX: position.x,
        positionY: position.y,
      });
    },
    [screenToFlowPosition, createNode],
  );

  const handleAddLabel = useCallback(() => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    createNode.mutate({
      type: "label",
      label: "New label",
      positionX: center.x,
      positionY: center.y,
    });
  }, [screenToFlowPosition, createNode]);
  const handleOpenSheet = useCallback(() => {
    setSheetOpen(true);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && !event.repeat) {
        const selected = nodes.filter((n) => n.selected);
        for (const node of selected) {
          deleteNode.mutate({ id: node.id });
        }
      }
    },
    [nodes, deleteNode],
  );

  return (
    <div className="relative flex-1" onKeyDown={onKeyDown}>
      <ReactFlow
        nodes={nodes}
        edges={EMPTY_EDGES}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        deleteKeyCode={null}
        className="!bg-muted/60 [&_.react-flow__controls]:border-border/30 [&_.react-flow__controls-button]:border-border/20 [&_.react-flow__controls]:overflow-hidden [&_.react-flow__controls]:rounded-lg [&_.react-flow__controls]:shadow-[0_1px_4px_0_rgba(0,0,0,0.04)]"
      >
        <Background gap={16} size={1.2} color="var(--muted-foreground)" bgColor="transparent" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Floating toolbar */}
      <div className="bg-background/70 border-border/30 absolute top-3 left-3 z-10 flex items-center gap-px rounded-lg border p-1 shadow-[0_1px_6px_0_rgba(0,0,0,0.04)] backdrop-blur-md">
        <Link href="/agents">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium"
          >
            <ArrowLeft className="size-3" />
            Back
          </Button>
        </Link>
        <div className="bg-border/40 mx-0.5 h-4 w-px" />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium"
          onClick={handleAddLabel}
        >
          <StickyNote className="size-3" />
          Add Label
        </Button>
        {isMobile && (
          <>
            <div className="bg-border/40 mx-0.5 h-4 w-px" />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium"
              onClick={handleOpenSheet}
            >
              <Users className="size-3" />
              Coworkers
              {unassignedCoworkers.length > 0 && (
                <span className="bg-muted text-muted-foreground/70 rounded-md px-1.5 py-px text-[10px] font-medium tabular-nums">
                  {unassignedCoworkers.length}
                </span>
              )}
            </Button>
          </>
        )}
      </div>

      {isMobile && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="flex w-[300px] flex-col p-0">
            <UnassignedSidebarContent coworkers={unassignedCoworkers} onAdd={onAddCoworker} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
