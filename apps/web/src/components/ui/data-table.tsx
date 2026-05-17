"use client";

import {
  type ColumnDef,
  type Row,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Render an expanded row below the main row */
  renderSubRow?: (row: Row<TData>) => ReactNode;
  /** Enable row expansion on click */
  expandable?: boolean;
  /** Global filter value for client-side filtering */
  globalFilter?: string;
  /** Callback when global filter changes */
  onGlobalFilterChange?: (value: string) => void;
};

export function DataTable<TData>({
  columns,
  data,
  renderSubRow,
  expandable,
  globalFilter,
  onGlobalFilterChange,
}: DataTableProps<TData>) {
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const table = useReactTable({
    data,
    columns,
    state: { expanded, globalFilter },
    onExpandedChange: expandable ? setExpanded : undefined,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: expandable ? getExpandedRowModel() : undefined,
    getFilteredRowModel: globalFilter !== undefined ? getFilteredRowModel() : undefined,
    enableSorting: false,
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b text-left">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={cn(
                    "px-4 py-3 font-medium",
                    header.column.columnDef.meta?.align === "right" && "text-right",
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-muted-foreground px-4 py-8 text-center">
                No data
              </td>
            </tr>
          ) : (
            table
              .getRowModel()
              .rows.map((row) => (
                <DataTableRow
                  key={row.id}
                  row={row}
                  expandable={expandable}
                  renderSubRow={renderSubRow}
                  colSpan={columns.length}
                />
              ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function DataTableRow<TData>({
  row,
  expandable,
  renderSubRow,
  colSpan,
}: {
  row: Row<TData>;
  expandable?: boolean;
  renderSubRow?: (row: Row<TData>) => ReactNode;
  colSpan: number;
}) {
  return (
    <>
      <tr
        className={cn("border-b last:border-b-0 hover:bg-muted/30", expandable && "cursor-pointer")}
        onClick={expandable ? row.getToggleExpandedHandler() : undefined}
      >
        {row.getVisibleCells().map((cell) => (
          <td
            key={cell.id}
            className={cn(
              "px-4 py-3",
              cell.column.columnDef.meta?.align === "right" && "text-right tabular-nums",
              cell.column.columnDef.meta?.className,
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
      {row.getIsExpanded() && renderSubRow && (
        <tr className="bg-muted/20 border-b">
          <td colSpan={colSpan} className="px-4 py-4">
            {renderSubRow(row)}
          </td>
        </tr>
      )}
    </>
  );
}

// Extend TanStack's ColumnMeta to support our custom fields
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "left" | "right";
    className?: string;
  }
}
