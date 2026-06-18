// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDurationDisplay,
  formatRelativeTime,
  type ModelRow,
  type SlowestRow,
} from "./analytics";

export const modelColumns: ColumnDef<ModelRow, unknown>[] = [
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
  },
  {
    accessorKey: "generationCount",
    header: "Count",
    meta: { align: "right" as const },
  },
  {
    accessorKey: "p50EndToEndMs",
    header: "P50 E2E",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDurationDisplay(getValue<number>()),
  },
  {
    accessorKey: "p95EndToEndMs",
    header: "P95 E2E",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDurationDisplay(getValue<number>()),
  },
  {
    accessorKey: "p50TtfvoMs",
    header: "P50 TTFVO",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDurationDisplay(getValue<number>()),
  },
  {
    accessorKey: "avgTokens",
    header: "Avg Tokens",
    meta: { align: "right" as const },
    cell: ({ getValue }) => getValue<number>().toLocaleString(),
  },
];

export const slowestColumns: ColumnDef<SlowestRow, unknown>[] = [
  {
    id: "expander",
    header: "",
    size: 32,
    enableSorting: false,
    cell: ({ row }) =>
      row.getIsExpanded() ? (
        <ChevronDown className="text-muted-foreground size-4" />
      ) : (
        <ChevronRight className="text-muted-foreground size-4" />
      ),
  },
  {
    accessorKey: "createdAt",
    header: "Time",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(getValue<Date | null>())}
      </span>
    ),
  },
  {
    accessorKey: "conversationTitle",
    header: "Conversation",
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string | null>() ?? "Untitled"}</span>
    ),
  },
  {
    accessorKey: "userEmail",
    header: "User",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {getValue<string | null>() ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {getValue<string | null>() ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "endToEndMs",
    header: "E2E",
    meta: { align: "right" as const },
    cell: ({ getValue }) => (
      <span className="font-medium tabular-nums">{formatDurationDisplay(getValue<number>())}</span>
    ),
  },
  {
    accessorKey: "sandboxMode",
    header: "Sandbox",
    cell: ({ getValue }) => {
      const mode = getValue<string | null>();
      if (!mode) {
        return "—";
      }
      return (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            mode === "reused"
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {mode}
        </span>
      );
    },
  },
];
