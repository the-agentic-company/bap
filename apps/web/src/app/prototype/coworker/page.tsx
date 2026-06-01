"use client";

// PROTOTYPE: Three single-coworker view directions for /prototype/coworker, switchable via ?variant=.
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  FileText,
  Gauge,
  History,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Play,
  Radar,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type VariantKey = "A" | "B" | "C" | "D";
type RunTone = "active" | "done" | "warning";

const VARIANTS: Array<{ key: VariantKey; label: string }> = [
  { key: "A", label: "Command profile" },
  { key: "B", label: "Work journal" },
  { key: "C", label: "Live desk" },
  { key: "D", label: "Run activity" },
];

const coworker = {
  name: "Revenue Radar",
  username: "revenue-radar",
  description:
    "Finds high-intent accounts, checks CRM context, and drafts follow-up briefs for the sales team.",
  status: "on",
  trigger: "Weekdays at 08:30",
  owner: "Growth workspace",
  model: "GPT-5.4",
  autonomy: "Auto-approve low-risk research",
  lastRun: "18 minutes ago",
  nextRun: "Tomorrow, 08:30",
};

const health = [
  { label: "Success", value: "94%", detail: "31 of 33 recent runs" },
  { label: "Avg runtime", value: "4m 12s", detail: "last 7 days" },
  { label: "Credits", value: "12.8k", detail: "this week" },
];

const runs: Array<{
  id: string;
  title: string;
  status: string;
  tone: RunTone;
  time: string;
  summary: string;
  artifacts: string[];
}> = [
  {
    id: "run-1042",
    title: "Morning expansion scan",
    status: "Running",
    tone: "active",
    time: "18m ago",
    summary: "Checking 47 target accounts for funding, hiring signals, and open opportunities.",
    artifacts: ["LinkedIn shortlist", "HubSpot enrichment", "Draft brief"],
  },
  {
    id: "run-1041",
    title: "Airtable pipeline review",
    status: "Completed",
    tone: "done",
    time: "Yesterday",
    summary: "Found 6 accounts with stale next steps and prepared suggested owner nudges.",
    artifacts: ["Pipeline deltas", "Slack update"],
  },
  {
    id: "run-1040",
    title: "Inbound lead triage",
    status: "Needs input",
    tone: "warning",
    time: "May 29",
    summary: "Paused before emailing two enterprise leads because Salesforce ownership conflicts.",
    artifacts: ["Conflict report", "Suggested assignees"],
  },
];

const tools = [
  { name: "HubSpot", access: "read + draft" },
  { name: "Gmail", access: "draft only" },
  { name: "LinkedIn", access: "read" },
  { name: "Slack", access: "post with approval" },
];

const memory = [
  "Prioritize accounts above 200 employees.",
  "Never email finance leads without owner approval.",
  "Use the MEDDICC note template for opportunity briefs.",
];

const messages = [
  { from: "Coworker", text: "I found three accounts that changed hiring velocity this week." },
  { from: "You", text: "Show me the ones with active opportunities first." },
  { from: "Coworker", text: "Top match is Northstar Bio. Opportunity is open, no next step set." },
];

const missionSteps = ["Detect account signal", "Draft owner brief", "Ask before outreach"];

const runSteps = ["Scanning accounts", "Checking CRM owners", "Drafting brief"];

const humanInputRunStatuses = new Set([
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

const tunePanelAction = { label: "Tune", icon: Settings2 };
const reviewPanelAction = { label: "Review", icon: ArrowRight };

function StatusPill({ tone, children }: { tone: RunTone | "on"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        "border-border bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          tone === "active" && "bg-foreground/60 animate-pulse",
          tone === "done" && "bg-foreground/50",
          tone === "warning" && "bg-muted-foreground",
          tone === "on" && "bg-green-500",
        )}
      />
      {children}
    </span>
  );
}

function StatePanel({ variant }: { variant: VariantKey }) {
  return (
    <section className="border-border/70 bg-muted/30 rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck className="size-4" />
        Prototype state
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Variant</dt>
          <dd className="font-medium">{variant}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Coworker</dt>
          <dd className="font-medium">{coworker.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Selected run</dt>
          <dd className="font-medium">{runs[0]?.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Mode</dt>
          <dd className="font-medium">Read-only prototype</dd>
        </div>
      </dl>
    </section>
  );
}

function CoworkerIdentity({ large = false }: { large?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <CoworkerAvatar
        username={coworker.username}
        size={large ? 72 : 48}
        className={cn("rounded-2xl", large && "rounded-[1.4rem]")}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn("truncate font-semibold", large ? "text-3xl" : "text-xl")}>
            {coworker.name}
          </h1>
          <StatusPill tone="on">On</StatusPill>
        </div>
        <p className="text-muted-foreground mt-1 font-mono text-xs">@{coworker.username}</p>
      </div>
    </div>
  );
}

function RunRow({ run, dense = false }: { run: (typeof runs)[number]; dense?: boolean }) {
  return (
    <article className="bg-background rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{run.title}</h3>
            <StatusPill tone={run.tone}>{run.status}</StatusPill>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">{run.time}</p>
        </div>
        <Button size="sm" variant="outline">
          <FileText className="size-4" />
          Open
        </Button>
      </div>
      <p className={cn("text-muted-foreground mt-3 text-sm leading-6", dense && "line-clamp-2")}>
        {run.summary}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {run.artifacts.map((artifact) => (
          <span
            key={artifact}
            className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs"
          >
            {artifact}
          </span>
        ))}
      </div>
    </article>
  );
}

function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("bg-card border-border rounded-xl border", className)}>
      {children}
    </section>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  detail?: string;
  action?: {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  };
}) {
  const ActionIcon = action?.icon;

  return (
    <div className="flex items-start justify-between gap-4 border-b p-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {detail ? <p className="text-muted-foreground mt-1 text-xs leading-5">{detail}</p> : null}
        </div>
      </div>
      {action && ActionIcon ? (
        <Button size="sm" variant="outline">
          <ActionIcon className="size-4" />
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function QuietBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex rounded-md px-2 py-1 text-xs">
      {children}
    </span>
  );
}

function ProgressStep({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="text-muted-foreground size-4" />
      ) : (
        <CircleDot className="text-muted-foreground size-4 animate-pulse" />
      )}
      <span>{label}</span>
    </div>
  );
}

function RunPanelCard({ run, active = false }: { run: (typeof runs)[number]; active?: boolean }) {
  const isRunning = run.status.toLowerCase() === "running";
  const needsHumanInput = humanInputRunStatuses.has(run.status.toLowerCase().replaceAll(" ", "_"));
  const runPath = `/coworkers/runs/${run.id}`;

  return (
    <article
      className={cn(
        "group relative rounded-lg border text-sm transition-colors",
        active ? "bg-muted/55" : "bg-card hover:bg-muted/30",
      )}
    >
      <Link href={runPath} prefetch={false} className="block px-4 py-3 pr-11">
        <div className="flex min-w-0 items-center gap-2">
          {isRunning ? (
            <LoaderCircle className="text-muted-foreground size-4 shrink-0 animate-spin" />
          ) : needsHumanInput ? (
            <span
              className="size-2.5 shrink-0 rounded-full bg-orange-500"
              aria-label="Needs human input"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate font-medium">{coworker.name}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{run.time}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 md:pl-6">
          <span className="text-muted-foreground truncate text-xs">{run.status}</span>
          <span className="bg-muted-foreground/30 size-1 shrink-0 rounded-full" />
          <span className="text-muted-foreground truncate text-xs">{run.title}</span>
        </div>
        <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-6">{run.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {run.artifacts.map((artifact) => (
            <QuietBadge key={artifact}>{artifact}</QuietBadge>
          ))}
        </div>
      </Link>
      <button
        type="button"
        className={cn(
          "text-muted-foreground hover:text-foreground absolute top-4 right-3 flex size-7 items-center justify-center rounded-md opacity-0 transition-opacity",
          "group-hover:opacity-100 focus-visible:opacity-100",
        )}
        aria-label="Run actions"
      >
        <MoreHorizontal className="size-4" />
      </button>
    </article>
  );
}

function CompactRunPanel({ className }: { className?: string }) {
  return (
    <Panel className={cn("overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Recent Runs
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">{runs.length}</span>
      </div>
      <div className="divide-y">
        {runs.map((run, index) => {
          const isRunning = run.status.toLowerCase() === "running";
          const needsHumanInput = humanInputRunStatuses.has(
            run.status.toLowerCase().replaceAll(" ", "_"),
          );

          return (
            <Link
              key={run.id}
              href={`/coworkers/runs/${run.id}`}
              prefetch={false}
              className={cn(
                "hover:bg-muted/30 group flex min-h-12 flex-col justify-center px-4 py-2 transition-colors",
                index === 0 && "bg-muted/40",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {isRunning ? (
                  <LoaderCircle className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
                ) : needsHumanInput ? (
                  <span
                    className="size-2.5 shrink-0 rounded-full bg-orange-500"
                    aria-label="Needs human input"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{coworker.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{run.time}</span>
              </span>
              <span className="text-muted-foreground truncate text-xs">{run.status}</span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function VariantA() {
  return (
    <main className="bg-background min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <PageHeader
          eyebrow="Coworker overview"
          title="One place to understand ownership, health, and next action"
          actions={
            <>
              <Button variant="outline">
                <MessageSquare className="size-4" />
                Ask
              </Button>
              <Button>
                <Play className="size-4" />
                Run now
              </Button>
            </>
          }
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Panel className="p-5">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="space-y-4">
                  <CoworkerIdentity large />
                  <p className="text-muted-foreground max-w-2xl text-sm leading-6">
                    {coworker.description}
                  </p>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-3 md:w-[430px]">
                  {health.map((item) => (
                    <div key={item.label} className="border-l pl-3">
                      <p className="text-muted-foreground text-xs">{item.label}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
                      <p className="text-muted-foreground mt-1 text-xs leading-4">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={Gauge}
                title="Operating model"
                detail="The expected loop is visible before recent runs, so setup is easier to audit."
                action={tunePanelAction}
              />
              <div className="grid gap-0 md:grid-cols-3">
                {missionSteps.map((step, index) => (
                  <div
                    key={step}
                    className="border-b p-4 last:border-r-0 md:border-r md:border-b-0"
                  >
                    <p className="text-muted-foreground text-xs">Step {index + 1}</p>
                    <p className="mt-2 text-sm font-medium">{step}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={History}
                title="Recent evidence"
                detail="Short, scannable proof of what changed."
              />
              <div className="divide-y">
                {runs.map((run) => (
                  <div key={run.id} className="p-4">
                    <RunRow run={run} dense />
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <aside className="space-y-5">
            <Panel>
              <PanelHeader icon={ShieldCheck} title="Configuration" />
              <dl className="px-4">
                <InfoRow label="Trigger" value={coworker.trigger} />
                <InfoRow label="Autonomy" value={coworker.autonomy} />
                <InfoRow label="Owner" value={coworker.owner} />
                <InfoRow label="Model" value={coworker.model} />
              </dl>
            </Panel>

            <Panel>
              <PanelHeader icon={Wrench} title="Tool access" />
              <div className="divide-y px-4">
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <span>{tool.name}</span>
                    <span className="text-muted-foreground text-right">{tool.access}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
        <StatePanel variant="A" />
      </div>
    </main>
  );
}

function VariantB() {
  return (
    <main className="bg-background min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <PageHeader
          eyebrow="Run review"
          title="Recent work first, coworker details second"
          actions={
            <>
              <Button variant="outline">
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button variant="outline">
                <Bell className="size-4" />
                Watch
              </Button>
            </>
          }
        />

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Panel className="overflow-hidden">
            <div className="border-b p-4">
              <CoworkerIdentity />
              <p className="text-muted-foreground mt-3 text-sm leading-6">{coworker.description}</p>
            </div>
            <div className="divide-y">
              {runs.map((run, index) => (
                <button
                  key={run.id}
                  type="button"
                  className={cn(
                    "hover:bg-muted/30 w-full px-4 py-3 text-left transition-colors",
                    index === 0 && "bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium">{run.title}</p>
                    <StatusPill tone={run.tone}>{run.status}</StatusPill>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{run.time}</p>
                </button>
              ))}
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel>
              <PanelHeader
                icon={Radar}
                title={runs[0].title}
                detail="Selected run detail, with enough context to decide whether to intervene."
                action={reviewPanelAction}
              />
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="p-5">
                  <StatusPill tone={runs[0].tone}>{runs[0].status}</StatusPill>
                  <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-6">
                    {runs[0].summary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {runs[0].artifacts.map((artifact) => (
                      <QuietBadge key={artifact}>{artifact}</QuietBadge>
                    ))}
                  </div>
                </div>
                <dl className="border-t px-5 lg:border-t-0 lg:border-l">
                  <InfoRow label="Started" value={runs[0].time} />
                  <InfoRow label="Next run" value={coworker.nextRun} />
                  <InfoRow label="Owner" value={coworker.owner} />
                </dl>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={FileText}
                title="Output queue"
                detail="Artifacts stay attached to the work, not buried in chat."
              />
              <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
                {runs[0].artifacts.map((artifact) => (
                  <div key={artifact} className="p-4">
                    <FileText className="text-muted-foreground size-4" />
                    <p className="mt-3 text-sm font-medium">{artifact}</p>
                    <p className="text-muted-foreground mt-1 text-xs">Ready to inspect</p>
                  </div>
                ))}
              </div>
            </Panel>

            <StatePanel variant="B" />
          </div>
        </div>
      </div>
    </main>
  );
}

function VariantC() {
  const [draft, setDraft] = useState("");
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  }, []);
  const handleDraftChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);

  return (
    <main className="bg-background min-h-screen p-3 md:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-7xl gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="bg-card grid min-h-[640px] grid-rows-[auto_minmax(0,1fr)_auto] rounded-xl border">
          <header className="border-b p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-4">
                <CoworkerAvatar username={coworker.username} size={44} className="rounded-xl" />
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs tracking-[0.14em] uppercase">
                    Live desk
                  </p>
                  <h1 className="truncate text-xl font-semibold">Ask, inspect, redirect</h1>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline">
                  <Zap className="size-4" />
                  Run now
                </Button>
                <Button variant="outline">
                  <Settings2 className="size-4" />
                  Edit
                </Button>
              </div>
            </div>
          </header>

          <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-0 overflow-auto p-4">
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={`${message.from}-${message.text}`}
                    className={cn(
                      "max-w-[82%] rounded-lg border p-3 text-sm leading-6",
                      message.from === "You"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-muted/50",
                    )}
                  >
                    <p className="mb-1 text-xs opacity-70">{message.from}</p>
                    {message.text}
                  </div>
                ))}
              </div>
            </div>

            <aside className="border-t p-4 lg:border-t-0 lg:border-l">
              <div className="flex items-center gap-2">
                <Radar className="text-muted-foreground size-4" />
                <h2 className="font-semibold">Active run</h2>
              </div>
              <div className="bg-muted/30 mt-4 rounded-lg border p-4">
                <StatusPill tone="active">{runs[0]?.status}</StatusPill>
                <h3 className="mt-3 font-medium">{runs[0]?.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{runs[0]?.summary}</p>
                <div className="mt-4 space-y-2">
                  {runSteps.map((step, index) => (
                    <ProgressStep key={step} done={index < 2} label={step} />
                  ))}
                </div>
              </div>
            </aside>
          </div>

          <form className="border-t p-3" onSubmit={handleSubmit}>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={handleDraftChange}
                placeholder="Ask this coworker about its work..."
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-10 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              />
              <Button type="submit">
                <Send className="size-4" />
                Send
              </Button>
            </div>
          </form>
        </section>

        <aside className="space-y-3">
          <Panel>
            <PanelHeader icon={Bot} title={coworker.name} detail={coworker.description} />
            <dl className="px-4">
              <InfoRow label="Trigger" value={coworker.trigger} />
              <InfoRow label="Autonomy" value={coworker.autonomy} />
              <InfoRow label="Last run" value={coworker.lastRun} />
            </dl>
          </Panel>

          <Panel>
            <PanelHeader icon={Wrench} title="Tools" />
            <div className="divide-y px-4">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span>{tool.name}</span>
                  <span className="text-muted-foreground">{tool.access}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader icon={Activity} title="Memory" />
            <div className="divide-y px-4">
              {memory.map((item) => (
                <p key={item} className="py-3 text-sm leading-5">
                  {item}
                </p>
              ))}
            </div>
          </Panel>

          <StatePanel variant="C" />
        </aside>
      </div>
    </main>
  );
}

function VariantD() {
  return (
    <main className="bg-background min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <PageHeader
          eyebrow="Recent runs"
          title="A full-page version of the coworker runs panel"
          actions={
            <>
              <Button variant="outline">
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button>
                <Play className="size-4" />
                Run now
              </Button>
            </>
          }
        />

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <CompactRunPanel />

            <Panel>
              <PanelHeader icon={Bot} title={coworker.name} detail={coworker.description} />
              <dl className="px-4">
                <InfoRow label="Trigger" value={coworker.trigger} />
                <InfoRow label="Last run" value={coworker.lastRun} />
                <InfoRow label="Next run" value={coworker.nextRun} />
              </dl>
            </Panel>
          </aside>

          <div className="space-y-3">
            <Panel className="p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <CoworkerIdentity />
                <div className="flex flex-wrap gap-2">
                  <QuietBadge>{runs.length} runs</QuietBadge>
                  <QuietBadge>{coworker.trigger}</QuietBadge>
                </div>
              </div>
            </Panel>

            {runs.map((run, index) => (
              <RunPanelCard key={run.id} run={run} active={index === 0} />
            ))}

            <StatePanel variant="D" />
          </div>
        </div>
      </div>
    </main>
  );
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentIndex = VARIANTS.findIndex((variant) => variant.key === current);
  const currentVariant = VARIANTS[currentIndex] ?? VARIANTS[0];

  const setVariant = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = (currentIndex + direction + VARIANTS.length) % VARIANTS.length;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("variant", VARIANTS[nextIndex].key);
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    },
    [currentIndex, pathname, router, searchParams],
  );
  const selectPrevious = useCallback(() => setVariant(-1), [setVariant]);
  const selectNext = useCallback(() => setVariant(1), [setVariant]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      if (isEditing) {
        return;
      }
      if (event.key === "ArrowLeft") {
        setVariant(-1);
      }
      if (event.key === "ArrowRight") {
        setVariant(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setVariant]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black px-2 py-2 text-white shadow-2xl">
      <Button
        aria-label="Previous prototype variant"
        className="size-9 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/20"
        size="icon"
        type="button"
        variant="outline"
        onClick={selectPrevious}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="min-w-[180px] px-2 text-center text-sm font-medium">
        {currentVariant.key}: {currentVariant.label}
      </div>
      <Button
        aria-label="Next prototype variant"
        className="size-9 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/20"
        size="icon"
        type="button"
        variant="outline"
        onClick={selectNext}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export default function SingleCoworkerPrototypePage() {
  const searchParams = useSearchParams();
  const variant = useMemo<VariantKey>(() => {
    const requested = searchParams.get("variant");
    return requested === "B" || requested === "C" || requested === "D" ? requested : "A";
  }, [searchParams]);

  return (
    <>
      {variant === "A" ? (
        <VariantA />
      ) : variant === "B" ? (
        <VariantB />
      ) : variant === "C" ? (
        <VariantC />
      ) : (
        <VariantD />
      )}
      <PrototypeSwitcher current={variant} />
    </>
  );
}
