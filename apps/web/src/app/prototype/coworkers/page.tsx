"use client";

// PROTOTYPE: Four coworker directions for /prototype/coworkers, switchable via ?variant=.
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { Button } from "@/components/ui/button";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import { useCoworker, useCoworkerList, useCoworkerRuns } from "@/orpc/hooks";

type UserCoworkerVariant = "profile" | "runs" | "hub" | "briefing";

type CoworkerSummary = {
  id: string;
  name?: string | null;
  username?: string | null;
  description?: string | null;
  status: "on" | "off";
  triggerType: string;
  recentRuns?: CoworkerRunSummary[];
  isPinned?: boolean;
};

type CoworkerRunSummary = {
  id: string;
  status: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  errorMessage?: string | null;
  conversationId?: string | null;
};

type CoworkerRunWithCoworker = CoworkerRunSummary & {
  coworkerId: string;
  coworkerName: string;
  coworkerUsername?: string | null;
};

const VARIANTS: Array<{ key: UserCoworkerVariant; label: string }> = [
  { key: "profile", label: "Coworker profile" },
  { key: "runs", label: "Run dashboard" },
  { key: "hub", label: "Conversation hub" },
  { key: "briefing", label: "Manager briefing" },
];
const EMPTY_COWORKER_RUNS: CoworkerRunWithCoworker[] = [];

const ACTIVE_RUN_STATUSES = new Set(["queued", "pending", "running", "waiting", "paused"]);
const FAILED_RUN_STATUSES = new Set(["error", "failed", "cancelled"]);
const DONE_RUN_STATUSES = new Set(["completed", "success"]);

function formatRelative(value?: Date | string | null): string {
  if (!value) {
    return "no timestamp";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "no timestamp";
  }

  const diffMin = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
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

function getRunTone(status: string): "active" | "failed" | "done" | "quiet" {
  if (FAILED_RUN_STATUSES.has(status)) {
    return "failed";
  }
  if (ACTIVE_RUN_STATUSES.has(status)) {
    return "active";
  }
  if (DONE_RUN_STATUSES.has(status)) {
    return "done";
  }
  return "quiet";
}

function RunStatusPill({ status }: { status: string }) {
  const tone = getRunTone(status);
  const Icon =
    tone === "active"
      ? Loader2
      : tone === "failed"
        ? XCircle
        : tone === "done"
          ? CheckCircle2
          : Clock3;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium capitalize",
        tone === "active" && "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        tone === "failed" && "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "done" && "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300",
        tone === "quiet" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className={cn("size-3", tone === "active" && "animate-spin")} />
      {getCoworkerRunStatusLabel(status)}
    </span>
  );
}

function selectDefaultCoworker(coworkers: CoworkerSummary[], requestedId: string | null) {
  return coworkers.find((coworker) => coworker.id === requestedId) ?? coworkers[0] ?? null;
}

function buildCoworkerRuns(
  coworker: CoworkerSummary,
  runs: CoworkerRunSummary[],
): CoworkerRunWithCoworker[] {
  return runs.map((run) => ({
    ...run,
    coworkerId: coworker.id,
    coworkerName: getCoworkerDisplayName(coworker.name),
    coworkerUsername: coworker.username,
  }));
}

function buildAllCoworkerRuns(
  coworkers: CoworkerSummary[],
  selectedCoworker: CoworkerSummary | null,
  selectedRuns: CoworkerRunSummary[],
): CoworkerRunWithCoworker[] {
  const runs = coworkers.flatMap((coworker) => {
    const sourceRuns =
      selectedCoworker?.id === coworker.id && selectedRuns.length > 0
        ? selectedRuns
        : (coworker.recentRuns ?? []);
    return buildCoworkerRuns(coworker, sourceRuns);
  });

  return runs.toSorted((left, right) => {
    const leftDate = left.startedAt ? new Date(left.startedAt).getTime() : 0;
    const rightDate = right.startedAt ? new Date(right.startedAt).getTime() : 0;
    return rightDate - leftDate;
  });
}

function useSelectedCoworkerData() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const coworkersQuery = useCoworkerList();
  const coworkers = useMemo(
    () => ((coworkersQuery.data ?? []) as CoworkerSummary[]).filter((coworker) => coworker.id),
    [coworkersQuery.data],
  );
  const selectedCoworker = selectDefaultCoworker(coworkers, searchParams.get("coworkerId"));
  const selectedCoworkerId = selectedCoworker?.id;
  const coworkerQuery = useCoworker(selectedCoworkerId);
  const runsQuery = useCoworkerRuns(selectedCoworkerId, 30);

  const selectCoworker = useCallback(
    (coworkerId: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("coworkerId", coworkerId);
      router.replace(`${pathname}?${nextParams.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const runs = useMemo<CoworkerRunSummary[]>(() => {
    const detailedRuns = (runsQuery.data ?? []) as CoworkerRunSummary[];
    return detailedRuns.length > 0 ? detailedRuns : (selectedCoworker?.recentRuns ?? []);
  }, [runsQuery.data, selectedCoworker?.recentRuns]);

  return {
    coworkers,
    selectedCoworker,
    selectedCoworkerDetail: coworkerQuery.data,
    runs,
    selectCoworker,
    isLoading: coworkersQuery.isLoading,
    isRefreshing: coworkersQuery.isFetching || coworkerQuery.isFetching || runsQuery.isFetching,
  };
}

function CoworkerRoster({
  coworkers,
  selectedCoworkerId,
  onSelect,
  compact = false,
}: {
  coworkers: CoworkerSummary[];
  selectedCoworkerId?: string;
  onSelect: (coworkerId: string) => void;
  compact?: boolean;
}) {
  return (
    <aside
      className={cn(
        "min-w-0 border-r border-border/40 bg-card",
        compact ? "w-full" : "w-[320px] shrink-0",
      )}
    >
      <div className="border-b border-border/40 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Coworkers</h2>
          <span className="text-muted-foreground text-xs">{coworkers.length}</span>
        </div>
      </div>
      <div className="space-y-1 p-2">
        {coworkers.map((coworker) => {
          const selected = coworker.id === selectedCoworkerId;

          return (
            <CoworkerRosterRow
              key={coworker.id}
              coworker={coworker}
              selected={selected}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </aside>
  );
}

function CoworkerRosterRow({
  coworker,
  selected,
  onSelect,
}: {
  coworker: CoworkerSummary;
  selected: boolean;
  onSelect: (coworkerId: string) => void;
}) {
  const latestRun = coworker.recentRuns?.[0];
  const handleSelect = useCallback(() => onSelect(coworker.id), [coworker.id, onSelect]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        selected && "bg-muted/60 ring-1 ring-border/40",
      )}
    >
      <CoworkerAvatar
        username={coworker.username ?? coworker.name}
        size={36}
        className="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{getCoworkerDisplayName(coworker.name)}</p>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              coworker.status === "on" ? "bg-green-500" : "bg-muted-foreground/40",
            )}
          />
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {latestRun
            ? `${getCoworkerRunStatusLabel(latestRun.status)} · ${formatRelative(latestRun.startedAt)}`
            : "No runs yet"}
        </p>
      </div>
    </button>
  );
}

function LocalChatPanel({
  coworker,
  detailPrompt,
  compact = false,
}: {
  coworker: CoworkerSummary;
  detailPrompt?: string | null;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const name = getCoworkerDisplayName(coworker.name);
  const handleDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
  }, []);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="text-muted-foreground size-4" />
          <h2 className="text-sm font-semibold">Talk to {name}</h2>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
        <div className="bg-muted max-w-[85%] rounded-lg px-3 py-2 text-sm">
          <p className="font-medium">{name}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {coworker.description ||
              detailPrompt ||
              "Ask for status, request a new run, or inspect recent work."}
          </p>
        </div>
        <div className="bg-foreground text-background ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm">
          Show me what you worked on recently and what needs my attention.
        </div>
        {!compact ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Prototype state: chat messages are local only. A production version would wire this
            panel to the coworker conversation or run trigger.
          </div>
        ) : null}
      </div>
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={handleDraftChange}
            placeholder={`Message ${name}`}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-20 flex-1 resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            type="button"
            size="icon"
            disabled={!draft.trim()}
            aria-label="Send prototype message"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

function RunRow({
  run,
  selected = false,
  onSelect,
}: {
  run: CoworkerRunSummary;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Run {run.id.slice(0, 8)}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{formatRelative(run.startedAt)}</p>
        </div>
        <RunStatusPill status={run.status} />
      </div>
      {run.errorMessage ? (
        <p className="text-muted-foreground mt-2 flex min-w-0 items-center gap-1.5 truncate text-xs">
          <AlertCircle className="size-3.5 shrink-0" />
          {run.errorMessage}
        </p>
      ) : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40",
          selected && "border-foreground/25 bg-muted/50",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={`/coworkers/runs/${run.id}`}
      className="bg-card hover:border-foreground/20 hover:bg-muted/40 block rounded-lg border p-3 transition-colors"
    >
      {content}
    </Link>
  );
}

function PrototypeStatePanel({
  variant,
  coworkerCount,
  selectedCoworkerId,
  runCount,
}: {
  variant: UserCoworkerVariant;
  coworkerCount: number;
  selectedCoworkerId?: string;
  runCount: number;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
      <div>prototype.variant: {variant}</div>
      <div>coworkers.count: {coworkerCount}</div>
      <div>selected.coworker: {selectedCoworkerId ?? "none"}</div>
      <div>selected.runs: {runCount}</div>
    </div>
  );
}

function WorkRunRow({ run }: { run: CoworkerRunWithCoworker }) {
  return (
    <Link
      href={`/coworkers/runs/${run.id}`}
      className="grid gap-3 border-b border-border/40 px-4 py-3 transition-colors hover:bg-muted/30 md:grid-cols-[240px_minmax(0,1fr)_150px]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CoworkerAvatar
          username={run.coworkerUsername ?? run.coworkerName}
          size={32}
          className="rounded-full"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{run.coworkerName}</p>
          <p className="text-muted-foreground text-xs">Run {run.id.slice(0, 8)}</p>
        </div>
      </div>
      <p className="text-muted-foreground min-w-0 truncate text-sm">
        {run.errorMessage || `Started ${formatRelative(run.startedAt)}`}
      </p>
      <div className="flex justify-start md:justify-end">
        <RunStatusPill status={run.status} />
      </div>
    </Link>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Icon className="mb-3 size-4 text-muted-foreground" />
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function VariantProfile({
  coworkers,
  selectedCoworker,
  selectedCoworkerDetail,
  runs,
  selectCoworker,
}: {
  coworkers: CoworkerSummary[];
  selectedCoworker: CoworkerSummary;
  selectedCoworkerDetail?: { prompt?: string | null };
  runs: CoworkerRunSummary[];
  selectCoworker: (coworkerId: string) => void;
}) {
  const activeRuns = useMemo(
    () => runs.filter((run) => getRunTone(run.status) === "active").length,
    [runs],
  );
  const failedRuns = useMemo(
    () => runs.filter((run) => getRunTone(run.status) === "failed").length,
    [runs],
  );
  const name = getCoworkerDisplayName(selectedCoworker.name);

  return (
    <main className="min-h-screen bg-background px-4 py-5">
      <div className="mx-auto grid w-full max-w-[1440px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm">
          <CoworkerRoster
            coworkers={coworkers}
            selectedCoworkerId={selectedCoworker.id}
            onSelect={selectCoworker}
            compact
          />
        </section>
        <div className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border/40 bg-muted/20 px-6 py-4">
              <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
                Coworker dossier
              </p>
            </div>
            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="flex min-w-0 gap-5">
                <CoworkerAvatar
                  username={selectedCoworker.username ?? selectedCoworker.name}
                  size={76}
                  className="rounded-md ring-1 ring-border"
                />
                <div className="min-w-0">
                  <h1 className="truncate text-3xl font-semibold tracking-tight">{name}</h1>
                  <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
                    {selectedCoworker.description ||
                      selectedCoworkerDetail?.prompt ||
                      "A compact personnel record for understanding what this coworker is responsible for before reviewing work or asking for a follow-up."}
                  </p>
                </div>
              </div>
              <PrototypeStatePanel
                variant="profile"
                coworkerCount={coworkers.length}
                selectedCoworkerId={selectedCoworker.id}
                runCount={runs.length}
              />
            </div>
          </section>
          <div className="grid gap-4 md:grid-cols-3">
            <StatTile icon={FileText} label="Recent runs" value={runs.length} />
            <StatTile icon={Loader2} label="Active now" value={activeRuns} />
            <StatTile icon={AlertCircle} label="Need review" value={failedRuns} />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">Evidence log</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Recent work attached to this coworker.
                  </p>
                </div>
                <Link
                  href={`/coworkers/${selectedCoworker.id}`}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted/50"
                >
                  Editor
                  <ArrowRight className="size-3" />
                </Link>
              </div>
              <div className="space-y-2 p-4">
                {runs.length > 0 ? (
                  runs.map((run) => <RunRow key={run.id} run={run} />)
                ) : (
                  <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
                    No runs yet.
                  </div>
                )}
              </div>
            </section>
            <section className="min-h-[520px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <LocalChatPanel
                coworker={selectedCoworker}
                detailPrompt={selectedCoworkerDetail?.prompt}
                compact
              />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function VariantRuns({
  coworkers,
  selectedCoworker,
  allRuns,
  selectCoworker,
}: {
  coworkers: CoworkerSummary[];
  selectedCoworker: CoworkerSummary;
  allRuns: CoworkerRunWithCoworker[];
  selectCoworker: (coworkerId: string) => void;
}) {
  const visibleRuns = useMemo(
    () => allRuns.filter((run) => run.coworkerId === selectedCoworker.id),
    [allRuns, selectedCoworker.id],
  );
  const activeRuns = useMemo(
    () => allRuns.filter((run) => getRunTone(run.status) === "active").length,
    [allRuns],
  );
  const failedRuns = useMemo(
    () => allRuns.filter((run) => getRunTone(run.status) === "failed").length,
    [allRuns],
  );

  return (
    <main className="min-h-screen bg-background px-4 py-5">
      <div className="mx-auto w-full max-w-[1500px] space-y-5">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
                Run ledger
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Work is the page, coworkers are filters
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                This direction behaves like an operations ledger: dense, sortable-feeling, and built
                for checking what happened before starting a conversation.
              </p>
            </div>
            <PrototypeStatePanel
              variant="runs"
              coworkerCount={coworkers.length}
              selectedCoworkerId={selectedCoworker.id}
              runCount={visibleRuns.length}
            />
          </div>
        </section>
        <div className="grid gap-4 md:grid-cols-3">
          <StatTile icon={BriefcaseBusiness} label="Visible runs" value={visibleRuns.length} />
          <StatTile icon={Loader2} label="Active across coworkers" value={activeRuns} />
          <StatTile icon={AlertCircle} label="Need review" value={failedRuns} />
        </div>
        <section className="rounded-xl border border-border bg-card p-2 shadow-sm">
          <div className="flex gap-2 overflow-x-auto">
            {coworkers.map((coworker) => (
              <CoworkerRosterRow
                key={coworker.id}
                coworker={coworker}
                selected={coworker.id === selectedCoworker.id}
                onSelect={selectCoworker}
              />
            ))}
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="text-muted-foreground grid grid-cols-[240px_minmax(0,1fr)_150px] border-b border-border/40 bg-muted/20 px-4 py-3 text-xs font-medium tracking-[0.12em] uppercase">
            <span>Owner and run</span>
            <span>Latest signal</span>
            <span className="text-right">State</span>
          </div>
          <div>
            {visibleRuns.length > 0 ? (
              visibleRuns.map((run) => <WorkRunRow key={run.id} run={run} />)
            ) : (
              <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
                No runs for this coworker yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function VariantHub({
  coworkers,
  selectedCoworker,
  selectedCoworkerDetail,
  runs,
  selectCoworker,
}: {
  coworkers: CoworkerSummary[];
  selectedCoworker: CoworkerSummary;
  selectedCoworkerDetail?: { prompt?: string | null };
  runs: CoworkerRunSummary[];
  selectCoworker: (coworkerId: string) => void;
}) {
  const latestRun = runs[0];
  const name = getCoworkerDisplayName(selectedCoworker.name);

  return (
    <main className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[330px_minmax(0,1fr)_310px]">
        <aside className="border-r border-border/40 bg-card">
          <div className="border-b border-border/40 p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
              Conversation hub
            </p>
            <h1 className="mt-1 text-lg font-semibold">Coworker threads</h1>
          </div>
          <div className="[&_aside]:border-0 [&_aside]:bg-transparent [&_button:hover]:bg-muted/50">
            <CoworkerRoster
              coworkers={coworkers}
              selectedCoworkerId={selectedCoworker.id}
              onSelect={selectCoworker}
              compact
            />
          </div>
        </aside>
        <section className="flex min-h-screen min-w-0 flex-col bg-background">
          <div className="bg-card flex items-center justify-between border-b border-border/40 px-6 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <CoworkerAvatar
                username={selectedCoworker.username ?? selectedCoworker.name}
                size={40}
                className="rounded-full"
              />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{name}</h2>
                <p className="text-muted-foreground truncate text-xs">
                  Runs appear inline as conversation artifacts.
                </p>
              </div>
            </div>
            <PrototypeStatePanel
              variant="hub"
              coworkerCount={coworkers.length}
              selectedCoworkerId={selectedCoworker.id}
              runCount={runs.length}
            />
          </div>
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm font-medium">{name}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                {selectedCoworker.description ||
                  selectedCoworkerDetail?.prompt ||
                  "Ready to discuss recent work."}
              </p>
            </div>
            {latestRun ? (
              <Link
                href={`/coworkers/runs/${latestRun.id}`}
                className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/30"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4" />
                    Latest run artifact
                  </span>
                  <RunStatusPill status={latestRun.status} />
                </div>
                <p className="text-muted-foreground text-sm">
                  Run {latestRun.id.slice(0, 8)} started {formatRelative(latestRun.startedAt)}.
                  {latestRun.errorMessage ? ` ${latestRun.errorMessage}` : ""}
                </p>
              </Link>
            ) : null}
            <div className="bg-foreground text-background ml-auto max-w-[82%] rounded-lg px-4 py-3 text-sm">
              What changed since I last checked?
            </div>
            <div className="rounded-lg bg-muted/50 p-4 text-sm">
              I would answer here with the recent run summary, blockers, and links to artifacts.
            </div>
          </div>
          <div className="bg-card border-t border-border/40 p-4">
            <LocalChatPanel
              coworker={selectedCoworker}
              detailPrompt={selectedCoworkerDetail?.prompt}
              compact
            />
          </div>
        </section>
        <aside className="hidden border-l border-border/40 bg-card p-4 lg:block">
          <h2 className="text-sm font-semibold">Artifacts</h2>
          <div className="mt-4 space-y-3">
            {runs.slice(0, 5).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function CoworkerBriefingCard({
  coworker,
  runs,
  selected,
  onSelect,
}: {
  coworker: CoworkerSummary;
  runs: CoworkerRunWithCoworker[];
  selected: boolean;
  onSelect: (coworkerId: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(coworker.id), [coworker.id, onSelect]);
  const attentionCount = useMemo(
    () => runs.filter((run) => getRunTone(run.status) === "failed").length,
    [runs],
  );
  const latestRun = runs[0];

  return (
    <button
      type="button"
      onClick={handleSelect}
      className={cn(
        "w-full border-b border-border/40 bg-card px-5 py-4 text-left transition-colors hover:bg-muted/30",
        selected && "bg-muted/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <CoworkerAvatar
            username={coworker.username ?? coworker.name}
            size={40}
            className="rounded-full"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {getCoworkerDisplayName(coworker.name)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {runs.length} recent runs · {attentionCount} need review
            </p>
          </div>
        </div>
        {latestRun ? <RunStatusPill status={latestRun.status} /> : null}
      </div>
      <p className="text-muted-foreground mt-4 text-sm">
        {latestRun
          ? `Latest work started ${formatRelative(latestRun.startedAt)}. ${latestRun.errorMessage ?? "No blocker recorded in the latest run."}`
          : "No work has run yet."}
      </p>
    </button>
  );
}

function VariantBriefing({
  coworkers,
  selectedCoworker,
  allRuns,
  selectCoworker,
}: {
  coworkers: CoworkerSummary[];
  selectedCoworker: CoworkerSummary;
  allRuns: CoworkerRunWithCoworker[];
  selectCoworker: (coworkerId: string) => void;
}) {
  const runsByCoworker = useMemo(() => {
    const map = new Map<string, CoworkerRunWithCoworker[]>();
    for (const run of allRuns) {
      const group = map.get(run.coworkerId) ?? [];
      group.push(run);
      map.set(run.coworkerId, group);
    }
    return map;
  }, [allRuns]);
  const attentionRuns = useMemo(
    () => allRuns.filter((run) => getRunTone(run.status) === "failed").length,
    [allRuns],
  );
  const selectedRuns = runsByCoworker.get(selectedCoworker.id) ?? EMPTY_COWORKER_RUNS;

  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto grid w-full max-w-[1320px] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border/40 px-7 py-6">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
              Manager briefing
            </p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight">
              What changed since you last checked
            </h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
              A memo-like surface for scanning coworker output before choosing where to intervene.
            </p>
          </div>
          <div className="grid gap-0 md:grid-cols-3">
            <div className="border-b border-border/40 p-5 md:border-r">
              <UserRound className="mb-3 size-4 text-muted-foreground" />
              <p className="text-2xl font-semibold">{coworkers.length}</p>
              <p className="text-muted-foreground text-xs">Coworkers</p>
            </div>
            <div className="border-b border-border/40 p-5 md:border-r">
              <BriefcaseBusiness className="mb-3 size-4 text-muted-foreground" />
              <p className="text-2xl font-semibold">{allRuns.length}</p>
              <p className="text-muted-foreground text-xs">Runs in digest</p>
            </div>
            <div className="border-b border-border/40 p-5">
              <AlertCircle className="mb-3 size-4 text-muted-foreground" />
              <p className="text-2xl font-semibold">{attentionRuns}</p>
              <p className="text-muted-foreground text-xs">Need review</p>
            </div>
          </div>
          <section>
            {coworkers.map((coworker) => (
              <CoworkerBriefingCard
                key={coworker.id}
                coworker={coworker}
                runs={runsByCoworker.get(coworker.id) ?? EMPTY_COWORKER_RUNS}
                selected={coworker.id === selectedCoworker.id}
                onSelect={selectCoworker}
              />
            ))}
          </section>
        </section>
        <aside className="space-y-5">
          <PrototypeStatePanel
            variant="briefing"
            coworkerCount={coworkers.length}
            selectedCoworkerId={selectedCoworker.id}
            runCount={allRuns.length}
          />
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4">
              <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
                Selected follow-up
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {getCoworkerDisplayName(selectedCoworker.name)}
              </h2>
            </div>
            <div className="space-y-2">
              {selectedRuns.slice(0, 4).map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <LocalChatPanel coworker={selectedCoworker} compact />
          </section>
        </aside>
      </div>
    </main>
  );
}

function EmptyCoworkers() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm rounded-lg border p-6 text-center">
        <Bot className="text-muted-foreground mx-auto mb-4 size-8" />
        <h1 className="text-lg font-semibold">No coworkers yet</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Create a coworker before using this prototype work surface.
        </p>
        <Link
          href="/coworkers/new"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium"
        >
          Create coworker
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function PrototypeSwitcher({ current }: { current: UserCoworkerVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentIndex = VARIANTS.findIndex((variant) => variant.key === current);
  const currentLabel = VARIANTS[currentIndex]?.label ?? VARIANTS[0].label;
  const selectVariant = useCallback(
    (offset: number) => {
      const nextIndex = (currentIndex + offset + VARIANTS.length) % VARIANTS.length;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("variant", VARIANTS[nextIndex].key);
      router.replace(`${pathname}?${nextParams.toString()}`);
    },
    [currentIndex, pathname, router, searchParams],
  );
  const selectPrevious = useCallback(() => selectVariant(-1), [selectVariant]);
  const selectNext = useCallback(() => selectVariant(1), [selectVariant]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        selectPrevious();
      }
      if (event.key === "ArrowRight") {
        selectNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectNext, selectPrevious]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div className="bg-foreground text-background fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border px-2 py-2 shadow-lg">
      <button
        type="button"
        onClick={selectPrevious}
        className="hover:bg-background/15 flex size-8 items-center justify-center rounded-full"
        aria-label="Previous prototype variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="min-w-[180px] text-center text-xs font-medium">
        {current.toUpperCase()} - {currentLabel}
      </div>
      <button
        type="button"
        onClick={selectNext}
        className="hover:bg-background/15 flex size-8 items-center justify-center rounded-full"
        aria-label="Next prototype variant"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export default function UserCoworkerPage() {
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get("variant");
  const variant = VARIANTS.some((entry) => entry.key === rawVariant)
    ? (rawVariant as UserCoworkerVariant)
    : "profile";
  const {
    coworkers,
    selectedCoworker,
    selectedCoworkerDetail,
    runs,
    selectCoworker,
    isLoading,
    isRefreshing,
  } = useSelectedCoworkerData();
  const allRuns = useMemo(
    () => buildAllCoworkerRuns(coworkers, selectedCoworker, runs),
    [coworkers, runs, selectedCoworker],
  );

  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!selectedCoworker) {
    return <EmptyCoworkers />;
  }

  return (
    <div className="relative min-h-screen pb-24">
      {isRefreshing ? (
        <div className="bg-background text-muted-foreground fixed top-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-sm">
          <Circle className="size-2 animate-pulse fill-current" />
          Refreshing
        </div>
      ) : null}
      {variant === "profile" ? (
        <VariantProfile
          coworkers={coworkers}
          selectedCoworker={selectedCoworker}
          selectedCoworkerDetail={selectedCoworkerDetail}
          runs={runs}
          selectCoworker={selectCoworker}
        />
      ) : null}
      {variant === "runs" ? (
        <VariantRuns
          coworkers={coworkers}
          selectedCoworker={selectedCoworker}
          allRuns={allRuns}
          selectCoworker={selectCoworker}
        />
      ) : null}
      {variant === "hub" ? (
        <VariantHub
          coworkers={coworkers}
          selectedCoworker={selectedCoworker}
          selectedCoworkerDetail={selectedCoworkerDetail}
          runs={runs}
          selectCoworker={selectCoworker}
        />
      ) : null}
      {variant === "briefing" ? (
        <VariantBriefing
          coworkers={coworkers}
          selectedCoworker={selectedCoworker}
          allRuns={allRuns}
          selectCoworker={selectCoworker}
        />
      ) : null}
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
