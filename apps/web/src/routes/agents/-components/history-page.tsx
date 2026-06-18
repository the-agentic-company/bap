import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { T, useGT } from "gt-react";
import {
  ArrowUpRight,
  CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  Pencil,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntegrationType } from "@/lib/integration-icons";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { INTEGRATION_DISPLAY_NAMES, INTEGRATION_LOGOS } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { type RunHistoryEntry, useRunHistory } from "@/orpc/hooks/coworkers";
import { AppImage as Image } from "../-lib/app-image";
import { AppLink as Link } from "../-lib/app-link";

type HistoryEntryStatus = RunHistoryEntry["status"];

function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "never";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffH < 24) {
    return `${diffH}h ago`;
  }
  if (diffD < 7) {
    return `${diffD}d ago`;
  }

  return date.toLocaleDateString();
}

function StatusBadge({ status }: { status: HistoryEntryStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        status === "success" && "bg-green-500/10 text-green-600 dark:text-green-400",
        status === "denied" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        status === "error" && "bg-red-500/10 text-red-600 dark:text-red-400",
        status === "pending" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      )}
    >
      {status === "success" && <CheckCircle2 className="size-3" />}
      {status === "denied" && <ShieldAlert className="size-3" />}
      {status === "error" && <XCircle className="size-3" />}
      {status === "pending" && <Clock3 className="size-3" />}
      {status}
    </span>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "default";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        accent === "red" && value > 0
          ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-muted/50 text-muted-foreground",
      )}
    >
      <span className="font-semibold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function PayloadPreview({ preview }: { preview: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const json = JSON.stringify(preview, null, 2);
  const lines = json.split("\n");
  const remainingLines = lines.slice(4);
  const isLong = remainingLines.some((line) => line.trim().length > 1);
  const displayText = expanded || !isLong ? json : lines.slice(0, 4).join("\n") + "\n...";

  return (
    <div className="mt-2">
      <pre
        className={cn(
          "bg-muted/50 overflow-x-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed",
          "text-muted-foreground",
        )}
      >
        {displayText}
      </pre>
      {isLong && (
        <button
          type="button"
          onClick={toggleExpanded}
          className="text-muted-foreground hover:text-foreground mt-1.5 flex items-center gap-1 text-[11px] font-medium transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" /> <T>Show less</T>
            </>
          ) : (
            <>
              <ChevronDown className="size-3" /> <T>Show more</T>
            </>
          )}
        </button>
      )}
    </div>
  );
}

function IntegrationLogo({
  integration,
  size = 20,
  className,
}: {
  integration: IntegrationType;
  size?: number;
  className?: string;
}) {
  const src = INTEGRATION_LOGOS[integration];
  const needsInvert = integration === "notion" || integration === "github";

  return (
    <Image
      src={src}
      alt={INTEGRATION_DISPLAY_NAMES[integration]}
      width={size}
      height={size}
      className={cn("shrink-0", needsInvert && "dark:invert", className)}
    />
  );
}

function RunActivityCard({ entry, isLast }: { entry: RunHistoryEntry; isLast: boolean }) {
  const integration = entry.integration as IntegrationType;

  return (
    <div className="relative flex gap-4">
      <div className="flex w-8 shrink-0 flex-col items-center">
        <div className="bg-card z-10 flex size-8 items-center justify-center rounded-lg border">
          <IntegrationLogo integration={integration} size={16} />
        </div>
        {!isLast && <div className="bg-border w-px flex-1" />}
      </div>

      <div className="bg-card mb-3 min-w-0 flex-1 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CoworkerAvatar username={entry.coworker.username} size={24} className="rounded-md" />
          <Link
            href={getCoworkerEditHref(entry.coworker)}
            className="group/name flex items-center gap-1 text-sm font-medium hover:underline"
          >
            {entry.coworker.name}
            <Pencil className="text-muted-foreground size-3 opacity-0 transition-opacity group-hover/name:opacity-100" />
          </Link>
          <span className="text-muted-foreground text-xs">
            {formatRelativeTime(entry.timestamp)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={getCoworkerEditHref(entry.coworker)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] font-medium transition-colors"
            >
              <T>View in editor</T>
              <ArrowUpRight className="size-3" />
            </Link>
            <Link
              href={`/agents/runs/${entry.runId}`}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] font-medium transition-colors"
            >
              <T>View run</T>
              <ArrowUpRight className="size-3" />
            </Link>
            <StatusBadge status={entry.status} />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{entry.operationLabel}</span>
          <span className="text-muted-foreground/50">
            <T>&rarr;</T>
          </span>
          <span className="font-medium">{entry.target}</span>
          <span className="text-muted-foreground/60 hidden text-xs sm:inline">
            {INTEGRATION_DISPLAY_NAMES[integration]}
          </span>
        </div>

        <PayloadPreview preview={entry.preview} />
      </div>
    </div>
  );
}

export default function RunHistoryPage() {
  const t = useGT();

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const queryRange = useMemo(() => {
    if (!dateRange?.from) {
      return undefined;
    }
    const to = dateRange.to ?? dateRange.from;
    const endOfDay = new Date(to);
    endOfDay.setHours(23, 59, 59, 999);
    return { from: dateRange.from, to: endOfDay };
  }, [dateRange]);
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useRunHistory(queryRange);
  const entries = useMemo(() => data?.pages.flatMap((page) => page.entries) ?? [], [data]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [coworkerFilter, setCoworkerFilter] = useState("all");
  const [integrationFilter, setIntegrationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value),
    [],
  );

  const handleClearDateRange = useCallback(() => setDateRange(undefined), []);
  const calendarDisabled = useMemo(() => ({ after: new Date() }), []);

  const coworkerOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const entry of entries) {
      if (!map.has(entry.coworker.id)) {
        map.set(entry.coworker.id, { id: entry.coworker.id, name: entry.coworker.name });
      }
    }

    return Array.from(map.values());
  }, [entries]);

  const integrationOptions = useMemo(() => {
    const unique = new Set<IntegrationType>();
    for (const entry of entries) {
      unique.add(entry.integration as IntegrationType);
    }

    return Array.from(unique);
  }, [entries]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();

    return entries.filter((entry) => {
      if (coworkerFilter !== "all" && entry.coworker.id !== coworkerFilter) {
        return false;
      }
      if (integrationFilter !== "all" && entry.integration !== integrationFilter) {
        return false;
      }
      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }

      const haystack = [
        entry.target,
        entry.operationLabel,
        entry.coworker.name,
        JSON.stringify(entry.preview),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [entries, search, coworkerFilter, integrationFilter, statusFilter]);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      runActivityToday: entries.filter((entry) => new Date(entry.timestamp) >= today).length,
      integrations: new Set(entries.map((entry) => entry.integration)).size,
      denied: entries.filter((entry) => entry.status === "denied").length,
      activeCoworkers: new Set(entries.map((entry) => entry.coworker.id)).size,
    };
  }, [entries]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const node = loadMoreRef.current;
    if (!node || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!isLoading && !error && entries.length === 0 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [entries.length, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          <T>Run History</T>
        </h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <StatPill label={t("run activity today")} value={stats.runActivityToday} />
          <StatPill label={t("integrations")} value={stats.integrations} />
          <StatPill label={t("denied")} value={stats.denied} accent="red" />
          <StatPill label={t("active coworkers")} value={stats.activeCoworkers} />
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground/60 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t('Search run activity... (e.g. "#general", "john@", "CSV export")')}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "w-[220px] justify-start text-left font-normal",
                  !dateRange?.from && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-1 size-3.5" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM d")} – {format(dateRange.to, "MMM d, yyyy")}
                    </>
                  ) : (
                    format(dateRange.from, "MMM d, yyyy")
                  )
                ) : (
                  "Date range"
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                disabled={calendarDisabled}
              />
            </PopoverContent>
          </Popover>
          {dateRange?.from && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleClearDateRange}
              className="text-muted-foreground"
            >
              <X className="size-3.5" />
            </Button>
          )}
          <Select value={coworkerFilter} onValueChange={setCoworkerFilter}>
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue placeholder={t("All coworkers")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <T>All coworkers</T>
              </SelectItem>
              {coworkerOptions.map((coworker) => (
                <SelectItem key={coworker.id} value={coworker.id}>
                  {coworker.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={integrationFilter} onValueChange={setIntegrationFilter}>
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue placeholder={t("All integrations")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <T>All integrations</T>
              </SelectItem>
              {integrationOptions.map((integration) => (
                <SelectItem key={integration} value={integration}>
                  {INTEGRATION_DISPLAY_NAMES[integration]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="w-[120px]">
              <SelectValue placeholder={t("All status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <T>All status</T>
              </SelectItem>
              <SelectItem value="success">
                <T>Success</T>
              </SelectItem>
              <SelectItem value="pending">
                <T>Pending</T>
              </SelectItem>
              <SelectItem value="denied">
                <T>Denied</T>
              </SelectItem>
              <SelectItem value="error">
                <T>Error</T>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16">
          <XCircle className="text-muted-foreground/40 mb-3 size-10" />
          <p className="text-muted-foreground text-sm font-medium">
            <T>Failed to load history</T>
          </p>
          <p className="text-muted-foreground/60 mt-1 text-xs">
            <T>Refresh the page and try again.</T>
          </p>
        </div>
      ) : (
        <div className="pt-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Search className="text-muted-foreground/30 mb-3 size-10" />
              <p className="text-muted-foreground text-sm font-medium">
                <T>No matching run activity found</T>
              </p>
              <p className="text-muted-foreground/60 mt-1 text-xs">
                {hasNextPage || isFetchingNextPage
                  ? "Loading older run activity..."
                  : "Try adjusting your search or filters."}
              </p>
            </div>
          ) : (
            filtered.map((entry, index) => (
              <RunActivityCard
                key={entry.id}
                entry={entry}
                isLast={index === filtered.length - 1}
              />
            ))
          )}

          {(hasNextPage || isFetchingNextPage) && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-6">
              {isFetchingNextPage ? (
                <Loader2 className="text-muted-foreground size-5 animate-spin" />
              ) : (
                <span className="text-muted-foreground text-xs">
                  <T>Scroll to load older run activity</T>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
