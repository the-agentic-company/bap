import { Plus, X } from "lucide-react";
import { type ComponentType, type Dispatch, type SetStateAction, useCallback } from "react";

/**
 * Controlled, illustratively-editable lists for the agent modal. The modal owns the state so the
 * "Deploy" prompt reflects the user's live edits. `EditableList` is a plain add / edit / remove
 * list (actions, outputs); `TriggerSelect` is the same but single-select (exactly one trigger is
 * active, the others stay visible and selectable). Rows are keyed by index, which keeps input
 * focus on edit (no reordering happens mid-typing).
 */
type Items = Dispatch<SetStateAction<string[]>>;

// Shared row body (text input + remove button) used by both editable and single-select rows.
function RowInput({
  value,
  placeholder,
  active,
  onChange,
  onRemove,
}: {
  value: string;
  placeholder: string;
  active?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
        className={[
          "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm transition-colors hover:border-[#E0D2C7] focus:border-[#D52B0C] focus:bg-[#FBF5F0] focus:outline-none",
          active === false ? "text-[#6E5C53]" : "text-[#241712]",
          active ? "font-medium" : "",
        ].join(" ")}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[#9C8A80] opacity-0 transition group-hover/row:opacity-100 hover:bg-[#FAE5DF] hover:text-[#D52B0C]"
      >
        <X className="size-3.5" />
      </button>
    </>
  );
}

function EditableRow({
  value,
  index,
  placeholder,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  placeholder: string;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChange(index, event.target.value),
    [onChange, index],
  );
  const handleRemove = useCallback(() => onRemove(index), [onRemove, index]);
  return (
    <div className="group/row flex items-center gap-2.5">
      <span className="size-1.5 shrink-0 rounded-full bg-[#D52B0C]" aria-hidden />
      <RowInput value={value} placeholder={placeholder} onChange={handleChange} onRemove={handleRemove} />
    </div>
  );
}

function TriggerRow({
  value,
  index,
  active,
  placeholder,
  onSelect,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  active: boolean;
  placeholder: string;
  onSelect: (index: number) => void;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const handleSelect = useCallback(() => onSelect(index), [onSelect, index]);
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChange(index, event.target.value),
    [onChange, index],
  );
  const handleRemove = useCallback(() => onRemove(index), [onRemove, index]);
  return (
    <div className="group/row flex items-center gap-2.5">
      <button
        type="button"
        onClick={handleSelect}
        aria-pressed={active}
        aria-label={`Select: ${value}`}
        className={[
          "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
          active ? "border-[#D52B0C] bg-[#D52B0C]" : "border-[#E0D2C7] bg-white hover:border-[#D52B0C]",
        ].join(" ")}
      >
        {active ? <span className="size-1.5 rounded-full bg-white" /> : null}
      </button>
      <RowInput
        value={value}
        placeholder={placeholder}
        active={active}
        onChange={handleChange}
        onRemove={handleRemove}
      />
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
}) {
  return (
    <p className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-[#9C8A80] uppercase">
      <Icon className="size-3.5 text-[#D52B0C]" />
      {label}
      {hint ? <span className="ml-1 normal-case tracking-normal text-[#9C8A80]/80">· {hint}</span> : null}
    </p>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] font-medium text-[#D52B0C] transition-colors hover:bg-[#FAE5DF]"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  );
}

export function EditableList({
  label,
  icon,
  addLabel,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  addLabel: string;
  placeholder: string;
  items: string[];
  onChange: Items;
}) {
  const update = useCallback(
    (index: number, value: string) =>
      onChange((prev) => prev.map((item, i) => (i === index ? value : item))),
    [onChange],
  );
  const remove = useCallback(
    (index: number) => onChange((prev) => prev.filter((_, i) => i !== index)),
    [onChange],
  );
  const add = useCallback(() => onChange((prev) => [...prev, ""]), [onChange]);

  return (
    <div>
      <SectionHeader icon={icon} label={label} />
      <div className="mt-2.5 space-y-1">
        {items.map((value, index) => (
          <EditableRow
            // oxlint-disable-next-line react/no-array-index-key -- positional rows, no reordering mid-edit
            key={index}
            value={value}
            index={index}
            placeholder={placeholder}
            onChange={update}
            onRemove={remove}
          />
        ))}
      </div>
      <AddButton label={addLabel} onClick={add} />
    </div>
  );
}

export function TriggerSelect({
  label,
  icon,
  addLabel,
  placeholder,
  hint,
  items,
  selected,
  onSelect,
  onChange,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  addLabel: string;
  placeholder: string;
  hint: string;
  items: string[];
  selected: number;
  onSelect: (index: number) => void;
  onChange: Items;
}) {
  const update = useCallback(
    (index: number, value: string) =>
      onChange((prev) => prev.map((item, i) => (i === index ? value : item))),
    [onChange],
  );
  const remove = useCallback(
    (index: number) => onChange((prev) => prev.filter((_, i) => i !== index)),
    [onChange],
  );
  const add = useCallback(() => onChange((prev) => [...prev, ""]), [onChange]);

  return (
    <div>
      <SectionHeader icon={icon} label={label} hint={hint} />
      <div className="mt-2.5 space-y-1">
        {items.map((value, index) => (
          <TriggerRow
            // oxlint-disable-next-line react/no-array-index-key -- positional rows, no reordering mid-edit
            key={index}
            value={value}
            index={index}
            active={index === selected}
            placeholder={placeholder}
            onSelect={onSelect}
            onChange={update}
            onRemove={remove}
          />
        ))}
      </div>
      <AddButton label={addLabel} onClick={add} />
    </div>
  );
}
