"use client";

/* oxlint-disable react-perf/jsx-no-new-object-as-prop -- motion props are declarative animation config */

import { Activity, Check, Loader2, Timer, Shield, Users, Clock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import {
  INTEGRATION_LOGOS,
  INTEGRATION_DISPLAY_NAMES,
  type IntegrationType,
} from "@/lib/integration-icons";

/* ═══════════════════════════════════════════════════════════════════════════════
   BENTO CARD WRAPPER
   ═══════════════════════════════════════════════════════════════════════════════ */

function BentoCard({
  children,
  className = "",
  gradient,
}: {
  children: React.ReactNode;
  className?: string;
  gradient?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={`group border-border/80 bg-background hover:border-border relative overflow-hidden rounded-2xl border transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] ${className}`}
    >
      {gradient && <div className={`pointer-events-none absolute inset-0 ${gradient}`} />}
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   LIVE DEMO FEED (large bento card)
   ═══════════════════════════════════════════════════════════════════════════════ */

type DemoItem = {
  id: string;
  integration: IntegrationType;
  label: string;
};

const DEMO_ITEMS: DemoItem[] = [
  { id: "1", integration: "hubspot", label: "Listing deals" },
  { id: "2", integration: "hubspot", label: "Getting deal → Acme Corp" },
  { id: "3", integration: "hubspot", label: "Listing contacts" },
  { id: "4", integration: "google_gmail", label: "Listing emails" },
  { id: "5", integration: "google_gmail", label: "Reading email → Re: Q2 proposal" },
  { id: "6", integration: "slack", label: "Searching messages → #sales-pipeline" },
  { id: "7", integration: "hubspot", label: "Updating deal → Acme Corp" },
  { id: "8", integration: "slack", label: "Sending message → #sales-alerts" },
  { id: "9", integration: "google_gmail", label: "Sending email → Follow-up: Acme Corp" },
  { id: "10", integration: "hubspot", label: "Creating task → Call with James" },
  { id: "11", integration: "salesforce", label: "Updating contact → James Miller" },
  { id: "12", integration: "slack", label: "Sending message → @sarah" },
];

const COWORKER_INTEGRATIONS: IntegrationType[] = ["hubspot", "google_gmail", "slack", "salesforce"];
const INTERVAL_MS = 2200;
const PAUSE_MS = 3000;

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function DemoActivityItem({ item, isLatest }: { item: DemoItem; isLatest: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 py-1 text-xs"
    >
      <img
        src={INTEGRATION_LOGOS[item.integration]}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        className="size-4 shrink-0"
      />
      <span className="text-foreground/90 font-mono text-[13px]">{item.label}</span>
      <div className="flex-1" />
      {isLatest ? (
        <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
      ) : (
        <Check className="size-3.5 shrink-0 text-green-500" />
      )}
    </motion.div>
  );
}

function LiveDemoCard() {
  const [visibleItems, setVisibleItems] = useState<DemoItem[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function next() {
      const idx = indexRef.current;
      if (idx < DEMO_ITEMS.length) {
        const item = DEMO_ITEMS[idx]!;
        indexRef.current = idx + 1;
        setVisibleItems((prev) => [...prev, item]);
        timer = setTimeout(next, INTERVAL_MS);
      } else {
        timer = setTimeout(() => {
          indexRef.current = 0;
          startTimeRef.current = Date.now();
          setVisibleItems([]);
          timer = setTimeout(next, 600);
        }, PAUSE_MS);
      }
    }
    timer = setTimeout(next, 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleItems]);

  return (
    <BentoCard
      className="h-full"
      gradient="bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.04),transparent_60%)]"
    >
      <div className="flex h-full flex-col p-6 md:p-8">
        {/* Card header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h3 className="text-foreground text-lg font-semibold">Real-time execution</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Watch your agents work across tools autonomously
            </p>
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Timer className="size-3.5" />
            {formatElapsed(elapsed)}
          </div>
        </div>

        {/* Agent info bar */}
        <div className="mb-4 flex items-center gap-3">
          <CoworkerAvatar username="sales-pipeline" size={32} className="shrink-0 rounded-full" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Sales Pipeline Agent</p>
            <p className="text-muted-foreground font-mono text-[10px]">@sales-pipeline</p>
          </div>
          <div className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2.5 text-[10px] font-medium text-green-600 dark:text-green-400">
            <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
            Running
          </div>
        </div>

        {/* Activity feed */}
        <div className="border-border/50 bg-muted/20 flex-1 overflow-hidden rounded-xl border">
          <div className="border-border/30 flex items-center gap-2 border-b px-4 py-2.5">
            <Activity className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-xs font-medium">Activity</span>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
              {visibleItems.length}
            </span>
          </div>
          <div ref={scrollRef} className="overflow-y-auto px-4 py-3" style={{ maxHeight: 280 }}>
            <AnimatePresence initial={false}>
              {visibleItems.map((item, i) => (
                <DemoActivityItem
                  key={item.id}
                  item={item}
                  isLatest={i === visibleItems.length - 1}
                />
              ))}
            </AnimatePresence>
            {visibleItems.length === 0 && (
              <div className="flex items-center gap-2 py-3">
                <span className="text-muted-foreground text-xs">Starting agent...</span>
                <div className="ml-auto flex gap-1">
                  <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                  <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                  <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full" />
                </div>
              </div>
            )}
          </div>
          <div className="border-border/30 flex items-center gap-2 border-t px-4 py-2">
            {COWORKER_INTEGRATIONS.map((key) => (
              <img
                key={key}
                src={INTEGRATION_LOGOS[key]}
                alt=""
                width={16}
                height={16}
                loading="lazy"
                decoding="async"
                className="size-4"
              />
            ))}
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RUNS WITHOUT YOU CARD (right column)
   ═══════════════════════════════════════════════════════════════════════════════ */

function ApprovalWorkflowsCard() {
  return (
    <BentoCard gradient="bg-[radial-gradient(ellipse_at_bottom_right,rgba(245,158,11,0.04),transparent_60%)]">
      <div className="p-6">
        <div className="bg-muted/60 border-border/40 mb-4 inline-flex size-10 items-center justify-center rounded-xl border">
          <Shield className="text-foreground/70 size-5" />
        </div>
        <h3 className="text-foreground text-[15px] font-semibold">Approval workflows</h3>
        <p className="text-muted-foreground mt-1.5 max-w-xs text-sm leading-relaxed">
          Every sensitive action goes through human review. Your agent asks before sending emails,
          updating CRM records, or posting messages.
        </p>
      </div>
    </BentoCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   INTEGRATIONS CARD (visual grid in bento)
   ═══════════════════════════════════════════════════════════════════════════════ */

const FEATURED_INTEGRATIONS: IntegrationType[] = [
  "google_gmail",
  "slack",
  "hubspot",
  "salesforce",
  "notion",
  "outlook",
  "github",
  "airtable",
  "google_calendar",
  "google_sheets",
  "google_drive",
  "linkedin",
];

function IntegrationsCard() {
  return (
    <BentoCard gradient="bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.04),transparent_60%)]">
      <div className="p-6">
        <h3 className="text-foreground text-[15px] font-semibold">Integrate with all your tools</h3>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">Connect your tools in one click.</p>
        <div className="grid grid-cols-4 gap-2.5">
          {FEATURED_INTEGRATIONS.map((key, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              whileHover={{ scale: 1.08, y: -3 }}
              className="border-border/50 bg-muted/30 hover:border-border flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border transition-shadow duration-200 hover:shadow-[0_4px_16px_rgb(0,0,0,0.06)]"
            >
              <img
                src={INTEGRATION_LOGOS[key]}
                alt={INTEGRATION_DISPLAY_NAMES[key]}
                width={24}
                height={24}
                loading="lazy"
                decoding="async"
                className="size-6"
              />
              <span className="text-muted-foreground text-[9px] leading-none font-medium">
                {INTEGRATION_DISPLAY_NAMES[key].replace("Google ", "").replace("Microsoft ", "")}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </BentoCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SMALL FEATURE CARDS (bottom row)
   ═══════════════════════════════════════════════════════════════════════════════ */

const FEATURE_CARDS = [
  {
    icon: Shield,
    title: "Full visibility",
    desc: "Every action logged. Every tool call traced. Complete audit trail for your team.",
    gradient: "bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.05),transparent_60%)]",
  },
  {
    icon: Users,
    title: "Team collaboration",
    desc: "Share agents across your team. Control who can edit, run, or approve.",
    gradient: "bg-[radial-gradient(ellipse_at_top_center,rgba(245,158,11,0.05),transparent_60%)]",
  },
  {
    icon: Clock,
    title: "Runs without you",
    desc: "Run every Monday at 9am, on every new CRM deal, or when an email arrives. They never stop.",
    gradient: "bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.05),transparent_60%)]",
  },
] as const;

function FeatureCard({ icon: Icon, title, desc, gradient }: (typeof FEATURE_CARDS)[number]) {
  return (
    <BentoCard gradient={gradient}>
      <div className="p-6">
        <div className="bg-muted/60 border-border/40 mb-4 inline-flex size-10 items-center justify-center rounded-xl border">
          <Icon className="text-foreground/70 size-5" />
        </div>
        <h3 className="text-foreground text-[15px] font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-1.5 max-w-xs text-sm leading-relaxed">{desc}</p>
      </div>
    </BentoCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SECTION EXPORT
   ═══════════════════════════════════════════════════════════════════════════════ */

export function BentoFeaturesSection() {
  return (
    <section className="bg-background relative z-10 px-6 pt-16 pb-20 md:pt-24 md:pb-28">
      <div className="mx-auto max-w-6xl">
        {/* Left-aligned header — strong typographic hierarchy */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 md:mb-20"
        >
          <h2 className="text-foreground max-w-lg text-3xl font-bold tracking-tight md:text-[2.75rem] md:leading-[1.15]">
            Ship AI agents that actually work
          </h2>
          <p className="text-muted-foreground mt-4 max-w-lg text-base leading-relaxed">
            Build, configure, and deploy autonomous coworkers that connect to your tools and run
            around the clock.
          </p>
        </motion.div>

        {/* Bento grid — consistent 2×3 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Large card: live demo — spans 2 cols, 2 rows */}
          <div className="md:col-span-2 lg:col-span-2 lg:row-span-2">
            <LiveDemoCard />
          </div>

          {/* Right column: integrations */}
          <IntegrationsCard />

          {/* Right column: approval workflows */}
          <ApprovalWorkflowsCard />

          {/* Bottom row: 3 feature cards */}
          {FEATURE_CARDS.map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>
      </div>
    </section>
  );
}
