/* oxlint-disable react-perf/jsx-no-new-object-as-prop -- motion props are declarative animation config */

import { ArrowUp, Check, Inbox, KeyRound, Loader2, Plus, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { INTEGRATION_LOGOS, type IntegrationType } from "@/lib/integration-icons";

/* ═══════════════════════════════════════════════════════════════════════════════
   DEMO DATA
   ═══════════════════════════════════════════════════════════════════════════════ */

type CoworkerData = {
  name: string;
  username: string;
  description: string;
  trigger: string;
  integrations: IntegrationType[];
};

// Initial 3 coworkers — always visible
const INITIAL_COWORKERS: CoworkerData[] = [
  {
    name: "Lead Qualifier",
    username: "lead-qualifier",
    description: "Scores incoming leads from HubSpot and routes hot leads",
    trigger: "On new lead",
    integrations: ["hubspot", "salesforce", "slack"],
  },
  {
    name: "Ticket Triage",
    username: "ticket-triage",
    description: "Reads support emails, creates tickets in Notion",
    trigger: "Email",
    integrations: ["google_gmail", "notion", "slack"],
  },
  {
    name: "Deal Closer",
    username: "deal-closer",
    description: "Drafts follow-up emails for stale pipeline deals",
    trigger: "Scheduled",
    integrations: ["salesforce", "google_gmail", "slack"],
  },
];

// Prompts that create NEW coworkers (added on top of the initial 3)
type PromptExample = {
  prompt: string;
  coworker: CoworkerData;
};

const PROMPT_EXAMPLES: PromptExample[] = [
  {
    prompt: "Track LinkedIn mentions and competitor posts, summarize weekly",
    coworker: {
      name: "Social Monitor",
      username: "social-monitor",
      description: "Monitors LinkedIn for brand mentions and competitor activity",
      trigger: "Scheduled",
      integrations: ["linkedin", "slack"],
    },
  },
  {
    prompt: "Every Monday pull campaign metrics from HubSpot and post a digest to Slack",
    coworker: {
      name: "Campaign Digest",
      username: "campaign-digest",
      description: "Weekly summary of campaign performance across channels",
      trigger: "Scheduled",
      integrations: ["hubspot", "google_sheets", "slack"],
    },
  },
  {
    prompt: "When a new GitHub issue is labeled urgent, notify the on-call team in Slack",
    coworker: {
      name: "Issue Alerter",
      username: "issue-alerter",
      description: "Watches GitHub for urgent issues and pings #on-call",
      trigger: "On new issue",
      integrations: ["github", "slack"],
    },
  },
];

/* ── Inbox timeline ── */

type InboxItemStatus = "awaiting_approval" | "awaiting_auth" | "completed" | "running";

type InboxItemData = {
  id: string;
  agentUsername: string;
  title: string;
  status: InboxItemStatus;
  integration: IntegrationType;
};

type TimelineEvent =
  | { type: "add"; item: InboxItemData }
  | { type: "dismiss"; itemId: string }
  | { type: "pause" };

const INBOX_TIMELINE: TimelineEvent[] = [
  {
    type: "add",
    item: {
      id: "a",
      agentUsername: "lead-qualifier",
      title: "Send email → james@acme.com",
      status: "awaiting_approval",
      integration: "google_gmail",
    },
  },
  {
    type: "add",
    item: {
      id: "b",
      agentUsername: "ticket-triage",
      title: "Create page → Ticket #413",
      status: "awaiting_approval",
      integration: "notion",
    },
  },
  { type: "pause" },
  {
    type: "add",
    item: {
      id: "c",
      agentUsername: "deal-closer",
      title: "Connect Salesforce",
      status: "awaiting_auth",
      integration: "salesforce",
    },
  },
  { type: "dismiss", itemId: "a" },
  {
    type: "add",
    item: {
      id: "d",
      agentUsername: "lead-qualifier",
      title: "Update deal score → Globex Inc",
      status: "completed",
      integration: "hubspot",
    },
  },
  { type: "pause" },
  { type: "dismiss", itemId: "b" },
  {
    type: "add",
    item: {
      id: "e",
      agentUsername: "ticket-triage",
      title: "Send message → #support-urgent",
      status: "running",
      integration: "slack",
    },
  },
  { type: "dismiss", itemId: "c" },
  {
    type: "add",
    item: {
      id: "f",
      agentUsername: "deal-closer",
      title: "Send email → Re: Q2 Renewal",
      status: "awaiting_approval",
      integration: "google_gmail",
    },
  },
  { type: "pause" },
  { type: "dismiss", itemId: "d" },
  { type: "dismiss", itemId: "e" },
  {
    type: "add",
    item: {
      id: "g",
      agentUsername: "lead-qualifier",
      title: "Listed mentions → 6 new",
      status: "completed",
      integration: "linkedin",
    },
  },
  { type: "dismiss", itemId: "f" },
  { type: "pause" },
];

const EVENT_INTERVAL_MS = 900;
const PAUSE_DURATION_MS = 1800;
const RESET_PAUSE_MS = 2200;

const STATUS_META: Record<
  InboxItemStatus,
  { color: string; dotColor: string; label: string; icon: typeof Check }
> = {
  awaiting_approval: {
    color: "text-amber-600",
    dotColor: "bg-amber-500",
    label: "Approve",
    icon: ShieldCheck,
  },
  awaiting_auth: {
    color: "text-orange-600",
    dotColor: "bg-orange-500",
    label: "Connect",
    icon: KeyRound,
  },
  completed: {
    color: "text-emerald-600",
    dotColor: "bg-emerald-500",
    label: "Done",
    icon: Check,
  },
  running: {
    color: "text-blue-600",
    dotColor: "bg-blue-500",
    label: "Running",
    icon: Loader2,
  },
};

const TYPING_SPEED_MS = 35;
const BUILD_DELAY_MS = 400;
const HOLD_AFTER_BUILD_MS = 1800;
const RESET_HOLD_MS = 3500;
const PLACEHOLDER_SLOT_KEYS = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"] as const;

/* ═══════════════════════════════════════════════════════════════════════════════
   DEMO PROMPT BAR
   ═══════════════════════════════════════════════════════════════════════════════ */

function DemoPromptBar({ text }: { text: string }) {
  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.15),0_0_0_1px_rgba(0,0,0,0.03)]">
      <div className="min-h-[120px] px-6 pt-5 pb-3">
        <span className="text-base leading-relaxed text-slate-800">
          {text}
          <span className="ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] animate-pulse bg-slate-400" />
        </span>
        {!text && (
          <span className="text-[15px] text-slate-300">Describe what you want to automate…</span>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-50"
          tabIndex={-1}
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm"
          tabIndex={-1}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   DEMO COWORKER CARD
   ═══════════════════════════════════════════════════════════════════════════════ */

function DemoCoworkerCard({
  coworker,
  animate: shouldAnimate = true,
}: {
  coworker: CoworkerData;
  animate?: boolean;
}) {
  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: 16, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
    >
      <div className="flex items-start gap-3">
        <CoworkerAvatar username={coworker.username} size={32} className="shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{coworker.name}</p>
            <div className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-[9px] font-medium text-emerald-700">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              On
            </div>
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{coworker.description}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              {coworker.trigger}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {coworker.integrations.map((key) => (
                <img
                  key={key}
                  src={INTEGRATION_LOGOS[key]}
                  alt=""
                  width={14}
                  height={14}
                  loading="lazy"
                  decoding="async"
                  className="size-3.5"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   DEMO INBOX ROW (animated)
   ═══════════════════════════════════════════════════════════════════════════════ */

function DemoInboxRow({ item, isDismissing }: { item: InboxItemData; isDismissing: boolean }) {
  const meta = STATUS_META[item.status];
  const StatusIcon = meta.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{
        opacity: isDismissing ? 0 : 1,
        height: isDismissing ? 0 : "auto",
        x: isDismissing ? 30 : 0,
      }}
      exit={{ opacity: 0, height: 0, x: 30 }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
      className="overflow-hidden border-b border-slate-100 last:border-b-0"
    >
      <div className="flex items-center gap-3 px-5 py-3">
        {/* Status dot */}
        <span className="relative flex size-2 shrink-0">
          {(item.status === "awaiting_approval" || item.status === "awaiting_auth") && (
            <span
              className={`absolute inset-0 animate-ping rounded-full opacity-40 ${meta.dotColor}`}
            />
          )}
          <span className={`relative inline-flex size-2 rounded-full ${meta.dotColor}`} />
        </span>

        {/* Avatar */}
        <CoworkerAvatar username={item.agentUsername} size={24} className="shrink-0 rounded-full" />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-800">{item.title}</span>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
            <img
              src={INTEGRATION_LOGOS[item.integration]}
              alt=""
              width={12}
              height={12}
              loading="lazy"
              decoding="async"
              className="size-3"
            />
            <span>@{item.agentUsername}</span>
          </div>
        </div>

        {/* Status label */}
        <div className={`flex shrink-0 items-center gap-1 text-[10px] font-medium ${meta.color}`}>
          <StatusIcon className={`size-3.5 ${item.status === "running" ? "animate-spin" : ""}`} />
          <span>{meta.label}</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ANIMATED INBOX PANEL
   ═══════════════════════════════════════════════════════════════════════════════ */

function AnimatedInboxPanel() {
  const [items, setItems] = useState<InboxItemData[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const eventIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(() => {
    const idx = eventIndexRef.current;

    // If we've gone through all events, reset and start over
    if (idx >= INBOX_TIMELINE.length) {
      eventIndexRef.current = 0;
      setItems([]);
      setDismissingIds(new Set());
      timerRef.current = setTimeout(tick, RESET_PAUSE_MS);
      return;
    }

    const event = INBOX_TIMELINE[idx]!;
    eventIndexRef.current = idx + 1;

    if (event.type === "add") {
      setItems((prev) => [event.item, ...prev]);
      timerRef.current = setTimeout(tick, EVENT_INTERVAL_MS);
    } else if (event.type === "dismiss") {
      setDismissingIds((prev) => new Set(prev).add(event.itemId));
      // Remove item after dismiss animation
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== event.itemId));
        setDismissingIds((prev) => {
          const next = new Set(prev);
          next.delete(event.itemId);
          return next;
        });
      }, 400);
      timerRef.current = setTimeout(tick, EVENT_INTERVAL_MS);
    } else {
      // pause
      timerRef.current = setTimeout(tick, PAUSE_DURATION_MS);
    }
  }, []);

  useEffect(() => {
    timerRef.current = setTimeout(tick, 600);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [tick]);

  const pendingCount = items.filter(
    (i) =>
      !dismissingIds.has(i.id) &&
      (i.status === "awaiting_approval" || i.status === "awaiting_auth"),
  ).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5">
        <Inbox className="size-5 text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">Inbox</span>
        <AnimatePresence>
          {pendingCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[9px] font-bold text-amber-700"
            >
              {pendingCount}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Rows */}
      <div className="min-h-[200px]">
        <AnimatePresence>
          {items.map((item) => (
            <DemoInboxRow key={item.id} item={item} isDismissing={dismissingIds.has(item.id)} />
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <div className="flex min-h-[200px] items-center justify-center">
            <span className="text-xs text-slate-300">No pending items</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN DEMO COMPONENT
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ReadmePreviewDemo() {
  const [promptIndex, setPromptIndex] = useState(0);
  const [typedText, setTypedText] = useState("");
  const [addedCoworkers, setAddedCoworkers] = useState<CoworkerData[]>([]);
  const [phase, setPhase] = useState<"typing" | "building" | "hold">("typing");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const currentPrompt = PROMPT_EXAMPLES[promptIndex % PROMPT_EXAMPLES.length]!;

  // Typing effect
  useEffect(() => {
    if (phase !== "typing") {
      return;
    }

    const prompt = currentPrompt.prompt;
    let charIndex = 0;
    setTypedText("");

    const interval = setInterval(() => {
      if (charIndex < prompt.length) {
        setTypedText(prompt.slice(0, charIndex + 1));
        charIndex++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          if (phaseRef.current === "typing") {
            setPhase("building");
          }
        }, BUILD_DELAY_MS);
      }
    }, TYPING_SPEED_MS);

    return () => clearInterval(interval);
  }, [phase, currentPrompt.prompt]);

  // Building phase — add coworker card
  useEffect(() => {
    if (phase !== "building") {
      return;
    }

    const coworker = currentPrompt.coworker;
    setAddedCoworkers((prev) =>
      prev.some((c) => c.username === coworker.username) ? prev : [...prev, coworker],
    );

    const timeout = setTimeout(() => {
      setPhase("hold");
    }, HOLD_AFTER_BUILD_MS);

    return () => clearTimeout(timeout);
  }, [phase, currentPrompt.coworker]);

  // Hold phase — advance to next prompt or reset
  const advance = useCallback(() => {
    const nextIndex = promptIndex + 1;

    if (nextIndex >= PROMPT_EXAMPLES.length) {
      // All extra coworkers added — hold, then remove added ones and restart
      setTimeout(() => {
        setAddedCoworkers([]);
        setPromptIndex(0);
        setTypedText("");
        setPhase("typing");
      }, RESET_HOLD_MS);
    } else {
      setPromptIndex(nextIndex);
      setTypedText("");
      setPhase("typing");
    }
  }, [promptIndex]);

  useEffect(() => {
    if (phase !== "hold") {
      return;
    }

    const timeout = setTimeout(advance, 200);
    return () => clearTimeout(timeout);
  }, [phase, advance]);

  // All coworkers: initial 3 + dynamically added ones
  const allCoworkers = [...INITIAL_COWORKERS, ...addedCoworkers];

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-slate-50/50 px-16">
      {/* Top row — Coworker cards (left) + Inbox (right) */}
      <div className="flex w-full items-start gap-8">
        {/* Coworker cards grid */}
        <div className="grid flex-1 grid-cols-2 gap-4">
          {/* Initial coworkers — no entry animation */}
          {INITIAL_COWORKERS.map((coworker) => (
            <DemoCoworkerCard key={coworker.username} coworker={coworker} animate={false} />
          ))}
          {/* Dynamically added coworkers — with animation */}
          <AnimatePresence>
            {addedCoworkers.map((coworker) => (
              <DemoCoworkerCard key={coworker.username} coworker={coworker} animate />
            ))}
          </AnimatePresence>
          {/* Placeholder slots for remaining empty spaces (grid of 2 cols, up to 6 total) */}
          {PLACEHOLDER_SLOT_KEYS.slice(0, Math.max(0, 6 - allCoworkers.length)).map((slotKey) => (
            <div
              key={slotKey}
              className="rounded-xl border border-dashed border-slate-200/60 bg-slate-50/50 p-4 opacity-40"
            >
              <div className="flex items-start gap-3">
                <div className="size-8 shrink-0 rounded-full bg-slate-100" />
                <div className="flex-1 space-y-1.5">
                  {/* name + On badge row */}
                  <div className="flex items-center gap-2">
                    <div className="h-3.5 w-24 rounded bg-slate-100" />
                    <div className="ml-auto h-5 w-10 rounded-full bg-slate-100" />
                  </div>
                  {/* description */}
                  <div className="h-3 w-full rounded bg-slate-100/70" />
                  {/* trigger + icons row */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div className="h-4 w-16 rounded-full bg-slate-100/50" />
                    <div className="ml-auto flex gap-1">
                      <div className="size-3.5 rounded bg-slate-100/50" />
                      <div className="size-3.5 rounded bg-slate-100/50" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Inbox */}
        <div className="w-[420px] shrink-0">
          <AnimatedInboxPanel />
        </div>
      </div>

      {/* Prompt bar — centered below both columns */}
      <div className="mt-8 w-full max-w-[680px]">
        <DemoPromptBar text={typedText} />
      </div>
    </main>
  );
}
