"use client";

/* oxlint-disable react-perf/jsx-no-new-object-as-prop -- motion props are declarative animation config */

import { Check, Loader2, ShieldCheck, KeyRound, Inbox } from "lucide-react";
import { motion, AnimatePresence, useInView } from "motion/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { INTEGRATION_LOGOS, type IntegrationType } from "@/lib/integration-icons";

/* ═══════════════════════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════════════════════ */

type ShowcaseAgent = {
  name: string;
  username: string;
  description: string;
  trigger: string;
  integrations: IntegrationType[];
};

const AGENTS: ShowcaseAgent[] = [
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
  {
    name: "Social Monitor",
    username: "social-monitor",
    description: "Tracks LinkedIn mentions and competitor posts",
    trigger: "Scheduled",
    integrations: ["linkedin", "slack"],
  },
];

/* ── Inbox timeline: ordered sequence of events ── */

type InboxItemStatus = "awaiting_approval" | "awaiting_auth" | "completed" | "running";

type DismissAction = "approve" | "deny" | "connect";

type TimelineEvent =
  | { type: "add"; item: InboxItemData }
  | { type: "dismiss"; itemId: string; action: DismissAction }
  | { type: "pulse"; agentIndex: number }
  | { type: "pause" };

type InboxItemData = {
  id: string;
  agentUsername: string;
  title: string;
  status: InboxItemStatus;
  integration: IntegrationType;
};

// Scripted sequence that loops
const TIMELINE: TimelineEvent[] = [
  // Initial burst — agents light up and add items
  { type: "pulse", agentIndex: 0 },
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
  { type: "pulse", agentIndex: 1 },
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
  { type: "pulse", agentIndex: 2 },
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
  { type: "pause" },
  { type: "dismiss", itemId: "a", action: "approve" },
  { type: "pulse", agentIndex: 0 },
  {
    type: "add",
    item: {
      id: "d",
      agentUsername: "lead-qualifier",
      title: "Update deal score → Acme Corp",
      status: "completed",
      integration: "hubspot",
    },
  },
  { type: "dismiss", itemId: "b", action: "approve" },
  { type: "pulse", agentIndex: 3 },
  {
    type: "add",
    item: {
      id: "e",
      agentUsername: "social-monitor",
      title: "Listed mentions → 6 new",
      status: "running",
      integration: "linkedin",
    },
  },
  { type: "pause" },
  { type: "dismiss", itemId: "c", action: "connect" },
  { type: "pulse", agentIndex: 1 },
  {
    type: "add",
    item: {
      id: "f",
      agentUsername: "ticket-triage",
      title: "Send message → #support-urgent",
      status: "completed",
      integration: "slack",
    },
  },
  { type: "dismiss", itemId: "d", action: "deny" },
  { type: "pulse", agentIndex: 2 },
  {
    type: "add",
    item: {
      id: "g",
      agentUsername: "deal-closer",
      title: "Send email → Re: Q2 Renewal",
      status: "awaiting_approval",
      integration: "google_gmail",
    },
  },
  { type: "pause" },
  { type: "dismiss", itemId: "e", action: "approve" },
  { type: "dismiss", itemId: "f", action: "approve" },
  { type: "dismiss", itemId: "g", action: "deny" },
  { type: "pause" },
];

const EVENT_INTERVAL_MS = 900;
const PAUSE_DURATION_MS = 1800;
const RESET_PAUSE_MS = 2500;

const STATUS_META: Record<
  InboxItemStatus,
  { color: string; dotColor: string; label: string; icon: typeof ShieldCheck }
> = {
  awaiting_approval: {
    color: "text-amber-500",
    dotColor: "bg-amber-500",
    label: "Approve",
    icon: ShieldCheck,
  },
  awaiting_auth: {
    color: "text-orange-500",
    dotColor: "bg-orange-500",
    label: "Connect",
    icon: KeyRound,
  },
  completed: {
    color: "text-green-500",
    dotColor: "bg-green-500",
    label: "Done",
    icon: Check,
  },
  running: {
    color: "text-blue-500",
    dotColor: "bg-blue-500",
    label: "Running",
    icon: Loader2,
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   AGENT MINI CARD
   ═══════════════════════════════════════════════════════════════════════════════ */

function AgentMiniCard({ agent, isPulsing }: { agent: ShowcaseAgent; isPulsing: boolean }) {
  return (
    <div
      className={`border-border/80 bg-background rounded-xl border p-3.5 transition-all duration-500 ${
        isPulsing ? "border-brand/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]" : ""
      }`}
    >
      <div className="flex items-start gap-2.5">
        <CoworkerAvatar username={agent.username} size={28} className="shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-foreground truncate text-xs font-semibold">{agent.name}</p>
            <div className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-1.5 text-[9px] font-medium text-green-600 dark:text-green-400">
              <span
                className={`size-1.5 rounded-full bg-green-500 ${isPulsing ? "animate-ping" : "animate-pulse"}`}
              />
              On
            </div>
          </div>
          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[10px]">
            {agent.description}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[8px] font-medium">
              {agent.trigger}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              {agent.integrations.map((key) => (
                <img
                  key={key}
                  src={INTEGRATION_LOGOS[key]}
                  alt=""
                  width={11}
                  height={11}
                  loading="lazy"
                  decoding="async"
                  className="size-[11px]"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   INBOX ROW
   ═══════════════════════════════════════════════════════════════════════════════ */

const ACTION_DISPLAY: Record<DismissAction, { label: string; color: string; dotColor: string }> = {
  approve: {
    label: "Approved",
    color: "text-green-600 dark:text-green-400",
    dotColor: "bg-green-500",
  },
  deny: { label: "Denied", color: "text-red-500", dotColor: "bg-red-500" },
  connect: { label: "Connected", color: "text-blue-500", dotColor: "bg-blue-500" },
};

// Shared ref map for status button positions
type ButtonPositionMap = Map<string, { x: number; y: number }>;

function InboxRow({
  item,
  isDismissing,
  cursorTarget,
  resolvedAction,
  inboxRef,
  buttonPositions,
}: {
  item: InboxItemData;
  isDismissing: boolean;
  cursorTarget: boolean;
  resolvedAction: DismissAction | null;
  inboxRef: React.RefObject<HTMLDivElement | null>;
  buttonPositions: ButtonPositionMap;
}) {
  const meta = STATUS_META[item.status];
  const StatusIcon = meta.icon;
  const actionDisplay = resolvedAction ? ACTION_DISPLAY[resolvedAction] : null;
  const statusRef = useRef<HTMLDivElement>(null);

  // Measure and register button position relative to inbox container
  useEffect(() => {
    const measure = () => {
      const btn = statusRef.current;
      const container = inboxRef.current;
      if (!btn || !container) {
        return;
      }
      const btnRect = btn.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      buttonPositions.set(item.id, {
        x: btnRect.left - containerRect.left + btnRect.width / 2,
        y: btnRect.top - containerRect.top + btnRect.height / 2,
      });
    };
    measure();
    // Re-measure on layout shifts
    const ro = new ResizeObserver(measure);
    if (statusRef.current) {
      ro.observe(statusRef.current);
    }
    return () => {
      ro.disconnect();
      buttonPositions.delete(item.id);
    };
  }, [item.id, inboxRef, buttonPositions]);

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
      className="border-border/40 relative overflow-hidden border-b last:border-b-0"
    >
      <div
        className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-300 ${
          cursorTarget ? "bg-brand/5" : ""
        }`}
      >
        {/* Status dot */}
        <span className="relative flex size-2 shrink-0">
          {!actionDisplay &&
            (item.status === "awaiting_approval" || item.status === "awaiting_auth") && (
              <span
                className={`absolute inset-0 animate-ping rounded-full opacity-40 ${meta.dotColor}`}
              />
            )}
          <span
            className={`relative inline-flex size-2 rounded-full ${actionDisplay ? actionDisplay.dotColor : meta.dotColor}`}
          />
        </span>

        {/* Avatar */}
        <CoworkerAvatar username={item.agentUsername} size={20} className="shrink-0 rounded-full" />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-[11px] font-medium">
            {item.title}
          </span>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[9px]">
            <img
              src={INTEGRATION_LOGOS[item.integration]}
              alt=""
              width={10}
              height={10}
              loading="lazy"
              decoding="async"
              className="size-2.5"
            />
            <span>@{item.agentUsername}</span>
          </div>
        </div>

        {/* Status — shows resolved action or original status */}
        <div
          ref={statusRef}
          className={`flex w-20 shrink-0 items-center justify-end gap-1 text-[9px] font-medium ${actionDisplay ? actionDisplay.color : meta.color}`}
        >
          <AnimatePresence mode="wait">
            {actionDisplay ? (
              <motion.span
                key="action"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1"
              >
                <Check className="size-3" />
                <span>{actionDisplay.label}</span>
              </motion.span>
            ) : (
              <motion.span key="status" className="flex items-center gap-1">
                <StatusIcon
                  className={`size-3 ${item.status === "running" ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline">{meta.label}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ORCHESTRATOR — runs the timeline loop
   ═══════════════════════════════════════════════════════════════════════════════ */

// Initial items so inbox is never empty on first render
const INITIAL_INBOX_ITEMS: InboxItemData[] = [
  {
    id: "init-1",
    agentUsername: "lead-qualifier",
    title: "Update deal score → Globex Inc",
    status: "completed",
    integration: "hubspot",
  },
  {
    id: "init-2",
    agentUsername: "ticket-triage",
    title: "Send message → #support-triage",
    status: "completed",
    integration: "slack",
  },
];

function useTimelineLoop(isActive: boolean, _buttonPositions: ButtonPositionMap) {
  const [items, setItems] = useState<InboxItemData[]>(INITIAL_INBOX_ITEMS);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [cursorTargetId, setCursorTargetId] = useState<string | null>(null);
  const [resolvedActions, setResolvedActions] = useState<Record<string, DismissAction>>({});
  const [pulsingAgent, setPulsingAgent] = useState<number | null>(null);
  const stepRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runStep = useCallback(() => {
    const step = stepRef.current;

    if (step >= TIMELINE.length) {
      setCursorTargetId(null);
      setPulsingAgent(null);
      timerRef.current = setTimeout(() => {
        setItems(INITIAL_INBOX_ITEMS);
        setDismissingId(null);
        setResolvedActions({});
        stepRef.current = 0;
        timerRef.current = setTimeout(runStep, 800);
      }, RESET_PAUSE_MS);
      return;
    }

    const event = TIMELINE[step]!;
    stepRef.current = step + 1;

    switch (event.type) {
      case "add":
        setPulsingAgent(null);
        setItems((prev) => [event.item, ...prev]);
        timerRef.current = setTimeout(runStep, EVENT_INTERVAL_MS);
        break;

      case "dismiss": {
        setCursorTargetId(event.itemId);
        timerRef.current = setTimeout(
          () => {
            setResolvedActions((prev) => ({ ...prev, [event.itemId]: event.action }));
            timerRef.current = setTimeout(() => {
              setDismissingId(event.itemId);
              timerRef.current = setTimeout(() => {
                setItems((prev) => prev.filter((i) => i.id !== event.itemId));
                setDismissingId(null);
                setCursorTargetId(null);
                setResolvedActions((prev) => {
                  const next = { ...prev };
                  delete next[event.itemId];
                  return next;
                });
                timerRef.current = setTimeout(runStep, 250);
              }, 400);
            }, 600);
          },
          event.action === "approve" || event.action === "connect" ? 420 : 120,
        );
        break;
      }

      case "pulse":
        setPulsingAgent(event.agentIndex);
        timerRef.current = setTimeout(() => {
          timerRef.current = setTimeout(runStep, 200);
        }, 400);
        break;

      case "pause":
        setCursorTargetId(null);
        timerRef.current = setTimeout(runStep, PAUSE_DURATION_MS);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    timerRef.current = setTimeout(runStep, 1200);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    // no-op: just ensures runStep recaptures `items`
  }, [runStep]);

  return {
    items,
    dismissingId,
    cursorTargetId,
    resolvedActions,
    pulsingAgent,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SECTION
   ═══════════════════════════════════════════════════════════════════════════════ */

export function TeamShowcaseSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const inboxRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: false, margin: "-120px" });
  const buttonPositionsRef = useRef<ButtonPositionMap>(new Map());

  const { items, dismissingId, cursorTargetId, resolvedActions, pulsingAgent } = useTimelineLoop(
    isInView,
    buttonPositionsRef.current,
  );

  const pendingCount = items.filter(
    (i) => i.status === "awaiting_approval" || i.status === "awaiting_auth",
  ).length;

  return (
    <section ref={sectionRef} className="bg-muted/20 border-border/40 border-t px-6 py-20 md:py-32">
      <div className="mx-auto max-w-6xl">
        {/* Header — left-aligned */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 md:mb-20"
        >
          <h2 className="text-foreground max-w-md text-3xl font-bold tracking-tight md:text-[2.75rem] md:leading-[1.15]">
            Coworkers that handle the work for you
          </h2>
          <p className="text-muted-foreground mt-4 max-w-lg text-base leading-relaxed">
            Your agents work autonomously and surface what matters to your inbox — approvals, auth
            requests, and results. You stay in control.
          </p>
        </motion.div>

        {/* Split layout: inbox first on mobile, agents left on desktop */}
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[1fr_1.2fr]">
          {/* Agent cards — order-2 on mobile (below inbox), order-1 on md+ (left) */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="order-2 space-y-2.5 md:order-1"
          >
            {AGENTS.map((agent, i) => (
              <AgentMiniCard key={agent.username} agent={agent} isPulsing={pulsingAgent === i} />
            ))}
          </motion.div>

          {/* Inbox feed — order-1 on mobile (above agents), order-2 on md+ (right) */}
          <motion.div
            ref={inboxRef}
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="border-border/80 bg-background relative order-1 flex flex-col overflow-hidden rounded-2xl border md:order-2"
          >
            {/* Header */}
            <div className="border-border/40 flex items-center gap-2.5 border-b px-4 py-3">
              <Inbox className="text-muted-foreground size-4" />
              <span className="text-foreground text-sm font-semibold">Inbox</span>
              <AnimatePresence>
                {pendingCount > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 tabular-nums dark:text-amber-400"
                  >
                    {pendingCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Items */}
            <div className="min-h-[280px] overflow-hidden">
              <AnimatePresence mode="popLayout">
                {items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    isDismissing={dismissingId === item.id}
                    cursorTarget={cursorTargetId === item.id}
                    resolvedAction={resolvedActions[item.id] ?? null}
                    inboxRef={inboxRef}
                    buttonPositions={buttonPositionsRef.current}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
