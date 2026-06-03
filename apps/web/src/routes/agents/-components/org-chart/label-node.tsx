"use client";

import { type NodeProps, type Node } from "@xyflow/react";
import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDeleteOrgChartNode, useUpdateOrgChartLabel } from "@/orpc/hooks";

export type LabelNodeData = {
  label: string;
  nodeId: string;
};

export type LabelNodeType = Node<LabelNodeData, "label">;

export function LabelNode({ data, selected }: NodeProps<LabelNodeType>) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data.label);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const updateLabel = useUpdateOrgChartLabel();
  const deleteNode = useDeleteOrgChartNode();

  const handleSave = useCallback(() => {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed && trimmed !== data.label) {
      updateLabel.mutate({ id: data.nodeId, label: trimmed });
    } else if (!trimmed) {
      setText(data.label);
    }
  }, [text, data.label, data.nodeId, updateLabel]);

  const handleDoubleClick = useCallback(() => {
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        setText(data.label);
        setEditing(false);
      }
    },
    [handleSave, data.label],
  );

  const handleDelete = useCallback(() => {
    deleteNode.mutate({ id: data.nodeId });
  }, [deleteNode, data.nodeId]);

  return (
    <div className="group relative max-w-[320px] min-w-[100px]" onDoubleClick={handleDoubleClick}>
      {editing ? (
        <textarea
          ref={inputRef}
          value={text}
          onChange={handleTextChange}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="text-foreground bg-card border-border/50 w-full resize-none rounded-lg border px-3 py-2 text-sm font-semibold tracking-[-0.01em] shadow-sm outline-none"
          rows={1}
        />
      ) : (
        <div
          className={cn(
            "bg-card text-foreground/80 cursor-grab rounded-lg border border-border/40 px-3 py-2 text-sm font-semibold tracking-[-0.01em] shadow-sm transition-all duration-150 select-none",
            "hover:text-foreground hover:border-border/60 hover:shadow-md",
            selected && "text-foreground border-border/60 ring-ring/20 ring-2",
          )}
        >
          {data.label}
        </div>
      )}
      <button
        type="button"
        onClick={handleDelete}
        className={cn(
          "absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full transition-all duration-150",
          "bg-foreground/80 text-background hover:bg-destructive",
          selected
            ? "scale-100 opacity-100"
            : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100",
        )}
      >
        <X className="size-2.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
