import { Plus, X } from "lucide-react";
import { type ComponentType, useCallback, useRef, useState } from "react";

/**
 * A small, illustratively-editable list used inside the agent modal to make it crystal clear
 * that every part of an agent (triggers, actions, outputs) is customizable: each line can be
 * edited in place, removed, and new ones added. State is local (resets when the modal closes),
 * the point is to show the bespoke nature, not to persist anything here.
 *
 * Rows carry a stable id (not the array index) so editing/removing keeps input focus correct.
 */
type Row = { id: number; value: string };

function EditableRow({
  row,
  placeholder,
  onChange,
  onRemove,
}: {
  row: Row;
  placeholder: string;
  onChange: (id: number, value: string) => void;
  onRemove: (id: number) => void;
}) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChange(row.id, event.target.value),
    [onChange, row.id],
  );
  const handleRemove = useCallback(() => onRemove(row.id), [onRemove, row.id]);

  return (
    <div className="group/row flex items-center gap-2.5">
      <span className="size-1.5 shrink-0 rounded-full bg-[#D52B0C]" aria-hidden />
      <input
        value={row.value}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-[#241712] transition-colors hover:border-[#E0D2C7] focus:border-[#D52B0C] focus:bg-[#FBF5F0] focus:outline-none"
      />
      <button
        type="button"
        onClick={handleRemove}
        aria-label="Remove"
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[#9C8A80] opacity-0 transition group-hover/row:opacity-100 hover:bg-[#FAE5DF] hover:text-[#D52B0C]"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function EditableList({
  label,
  icon: Icon,
  addLabel,
  placeholder,
  items,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  addLabel: string;
  placeholder: string;
  items: string[];
}) {
  const idRef = useRef(items.length);
  const [rows, setRows] = useState<Row[]>(() => items.map((value, index) => ({ id: index, value })));

  const update = useCallback((id: number, value: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)));
  }, []);
  const remove = useCallback((id: number) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);
  const add = useCallback(() => {
    setRows((prev) => [...prev, { id: idRef.current++, value: "" }]);
  }, []);

  return (
    <div>
      <p className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-[#9C8A80] uppercase">
        <Icon className="size-3.5 text-[#D52B0C]" />
        {label}
      </p>
      <div className="mt-2.5 space-y-1">
        {rows.map((row) => (
          <EditableRow
            key={row.id}
            row={row}
            placeholder={placeholder}
            onChange={update}
            onRemove={remove}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] font-medium text-[#D52B0C] transition-colors hover:bg-[#FAE5DF]"
      >
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  );
}
