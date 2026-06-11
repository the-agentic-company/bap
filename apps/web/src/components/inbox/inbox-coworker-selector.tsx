import { T } from "gt-react";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  CoworkerCardContent,
  getCoworkerDisplayName,
  type CoworkerCardData,
} from "@/components/coworkers/coworker-card-content";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type InboxCoworkerSelectorItem = CoworkerCardData & {
  id: string;
};

const emptyFooter = <></>;

type Props = {
  coworkers: InboxCoworkerSelectorItem[];
  selectedCoworkerId?: string;
  onSelectCoworker: (coworkerId?: string) => void;
  isLoading?: boolean;
};

export function InboxCoworkerSelector({
  coworkers,
  selectedCoworkerId,
  onSelectCoworker,
  isLoading,
}: Props) {
  const [open, setOpen] = useState(false);
  const selectedCoworker = useMemo(
    () => coworkers.find((coworker) => coworker.id === selectedCoworkerId),
    [coworkers, selectedCoworkerId],
  );

  const handleSelectAll = useCallback(() => {
    onSelectCoworker(undefined);
    setOpen(false);
  }, [onSelectCoworker]);

  const handleSelectCoworker = useCallback(
    (coworkerId: string) => {
      onSelectCoworker(coworkerId);
      setOpen(false);
    },
    [onSelectCoworker],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="bg-background hover:bg-accent min-h-10 w-full justify-between rounded-lg px-3 py-2 text-left"
          disabled={isLoading && coworkers.length === 0}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
              <Users className="text-muted-foreground size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {selectedCoworker ? getCoworkerDisplayName(selectedCoworker.name) : "All coworkers"}
              </span>
              <span className="text-muted-foreground block truncate text-[11px]">
                {selectedCoworker?.username
                  ? `@${selectedCoworker.username}`
                  : "Filter run history"}
              </span>
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground ml-3 size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-2">
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className={cn(
              "hover:bg-muted/60 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
              !selectedCoworkerId ? "border-foreground/30 bg-muted/40" : "border-border",
            )}
          >
            <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
              <Users className="text-muted-foreground size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                <T>All coworkers</T>
              </span>
              <span className="text-muted-foreground block text-xs">
                <T>Show every coworker run in the recent history window.</T>
              </span>
            </span>
            {!selectedCoworkerId ? <Check className="size-4 shrink-0" /> : null}
          </button>

          <div
            data-testid="inbox-coworker-selector-list"
            className="max-h-[min(420px,calc(100vh-20rem))] overflow-y-auto pr-1"
          >
            <div className="space-y-2">
              {coworkers.map((coworker) => (
                <CoworkerSelectorRow
                  key={coworker.id}
                  coworker={coworker}
                  selected={coworker.id === selectedCoworkerId}
                  onSelect={handleSelectCoworker}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CoworkerSelectorRow({
  coworker,
  selected,
  onSelect,
}: {
  coworker: InboxCoworkerSelectorItem;
  selected: boolean;
  onSelect: (coworkerId: string) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(coworker.id);
  }, [coworker.id, onSelect]);
  return (
    <button
      type="button"
      onClick={handleClick}
      data-coworker-id={coworker.id}
      className={cn(
        "hover:bg-muted/50 relative flex w-full flex-col gap-3 rounded-xl border p-3 text-left transition-colors",
        selected ? "border-foreground/30 bg-muted/40" : "border-border",
      )}
    >
      <CoworkerCardContent coworker={coworker} footerSlot={emptyFooter} />
      {selected ? (
        <span className="bg-background border-border absolute right-3 bottom-3 flex size-6 items-center justify-center rounded-full border">
          <Check className="size-3.5" />
        </span>
      ) : null}
    </button>
  );
}
