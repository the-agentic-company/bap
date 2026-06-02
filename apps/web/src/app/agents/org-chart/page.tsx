"use client";

import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useCoworkerList, useCreateOrgChartNode, useOrgChartNodes } from "@/orpc/hooks";
import { OrgChartCanvas } from "./_components/org-chart-canvas";
import { UnassignedSidebar } from "./_components/unassigned-sidebar";

const EMPTY_COWORKERS: never[] = [];
const EMPTY_NODES: never[] = [];

function OrgChartInner() {
  const { data: coworkers, isLoading: loadingCoworkers } = useCoworkerList();
  const { data: chartNodes, isLoading: loadingChart } = useOrgChartNodes();
  const { screenToFlowPosition } = useReactFlow();
  const createNode = useCreateOrgChartNode();

  const coworkerList = coworkers ?? EMPTY_COWORKERS;
  const nodeList = chartNodes ?? EMPTY_NODES;

  const placedCoworkerIds = useMemo(
    () =>
      new Set(
        nodeList.filter((n) => n.type === "coworker" && n.coworkerId).map((n) => n.coworkerId!),
      ),
    [nodeList],
  );

  const unassigned = useMemo(
    () => coworkerList.filter((c) => !placedCoworkerIds.has(c.id)),
    [coworkerList, placedCoworkerIds],
  );

  const handleAddCoworker = useCallback(
    (coworkerId: string) => {
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      createNode.mutate({
        type: "coworker",
        coworkerId,
        positionX: center.x,
        positionY: center.y,
      });
    },
    [screenToFlowPosition, createNode],
  );

  if (loadingCoworkers || loadingChart) {
    return (
      <div className="bg-background flex h-full flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <OrgChartCanvas
        chartNodes={nodeList}
        coworkers={coworkerList}
        unassignedCoworkers={unassigned}
        onAddCoworker={handleAddCoworker}
      />
      <UnassignedSidebar coworkers={unassigned} onAdd={handleAddCoworker} />
    </>
  );
}

export default function OrgChartPage() {
  return (
    <div className="bg-background flex h-screen w-full">
      <ReactFlowProvider>
        <OrgChartInner />
      </ReactFlowProvider>
    </div>
  );
}
