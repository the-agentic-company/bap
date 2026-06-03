"use client";

/* oxlint-disable react-perf/jsx-no-new-object-as-prop -- motion props are declarative animation config */

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { INTEGRATION_LOGOS, type IntegrationType } from "@/lib/integration-icons";

/* ═══════════════════════════════════════════════════════════════════════════════
   MOCK DATA — departments with positioned agent cards
   ═══════════════════════════════════════════════════════════════════════════════ */

type MockAgent = {
  name: string;
  username: string;
  description: string;
  trigger: string;
  status: "on" | "off";
  integrations: IntegrationType[];
  // position on canvas (px)
  x: number;
  y: number;
};

type Department = {
  label: string;
  labelX: number;
  labelY: number;
  color: string;
  agents: MockAgent[];
  // viewport center to zoom to
  focusX: number;
  focusY: number;
};

// Card is 220px wide. 2×2 department grid.
// Top row: Sales (left), Support (right)
// Bottom row: Marketing (left), Operations (right)
// Each dept: 2 cards side by side + 1 centered below

const DEPARTMENTS: Department[] = [
  {
    label: "Sales",
    labelX: 40,
    labelY: 20,
    color: "#3B82F6",
    focusX: 170,
    focusY: 130,
    agents: [
      {
        name: "Lead Qualifier",
        username: "lead-qualifier",
        description: "Scores leads from HubSpot, routes hot leads to reps",
        trigger: "On new lead",
        status: "on",
        integrations: ["hubspot", "salesforce", "slack"],
        x: 40,
        y: 50,
      },
      {
        name: "Deal Closer",
        username: "deal-closer",
        description: "Drafts follow-up emails for stale pipeline deals",
        trigger: "Scheduled",
        status: "on",
        integrations: ["salesforce", "google_gmail"],
        x: 290,
        y: 50,
      },
    ],
  },
  {
    label: "Support",
    labelX: 580,
    labelY: 20,
    color: "#06B6D4",
    focusX: 710,
    focusY: 130,
    agents: [
      {
        name: "Ticket Triage",
        username: "ticket-triage",
        description: "Categorizes emails by urgency, creates Notion tickets",
        trigger: "Email",
        status: "on",
        integrations: ["google_gmail", "notion", "slack"],
        x: 580,
        y: 50,
      },
      {
        name: "Escalation Bot",
        username: "escalation-bot",
        description: "Flags P0 tickets and pings on-call in Slack",
        trigger: "On new ticket",
        status: "on",
        integrations: ["slack", "github"],
        x: 830,
        y: 50,
      },
    ],
  },
  {
    label: "Marketing",
    labelX: 40,
    labelY: 250,
    color: "#F472B6",
    focusX: 170,
    focusY: 360,
    agents: [
      {
        name: "Social Monitor",
        username: "social-monitor",
        description: "Tracks LinkedIn mentions and competitor posts",
        trigger: "Scheduled",
        status: "on",
        integrations: ["linkedin", "slack"],
        x: 40,
        y: 280,
      },
      {
        name: "Campaign Digest",
        username: "campaign-digest",
        description: "Weekly metrics from HubSpot, posts to #marketing",
        trigger: "Scheduled",
        status: "on",
        integrations: ["hubspot", "google_sheets", "slack"],
        x: 290,
        y: 280,
      },
    ],
  },
  {
    label: "Operations",
    labelX: 580,
    labelY: 250,
    color: "#10B981",
    focusX: 710,
    focusY: 360,
    agents: [
      {
        name: "Invoice Sync",
        username: "invoice-sync",
        description: "Reconciles Stripe payments with accounting records",
        trigger: "Scheduled",
        status: "on",
        integrations: ["google_sheets", "slack"],
        x: 580,
        y: 280,
      },
      {
        name: "Onboarding Bot",
        username: "onboarding-bot",
        description: "Sets up new hires in Notion, Slack, and Google",
        trigger: "On new hire",
        status: "on",
        integrations: ["notion", "slack", "google_calendar"],
        x: 830,
        y: 280,
      },
    ],
  },
];

const CYCLE_INTERVAL_MS = 2200;
const OVERVIEW_PAUSE_MS = 5000;

/* ═══════════════════════════════════════════════════════════════════════════════
   MINI COWORKER CARD (static, for canvas)
   ═══════════════════════════════════════════════════════════════════════════════ */

function MiniCard({ agent, isHighlighted }: { agent: MockAgent; isHighlighted: boolean }) {
  return (
    <motion.div
      animate={{
        scale: isHighlighted ? 1 : 0.92,
        opacity: isHighlighted ? 1 : 0.55,
      }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
      className="bg-background border-border/80 absolute w-[220px] rounded-xl border p-3.5 shadow-sm"
      style={{ left: agent.x, top: agent.y }}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <CoworkerAvatar username={agent.username} size={28} className="shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-xs leading-tight font-semibold">
            {agent.name}
          </p>
          <p className="text-muted-foreground font-mono text-[9px]">@{agent.username}</p>
        </div>
        <div
          className={`inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[9px] font-medium ${
            agent.status === "on"
              ? "border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400"
              : "border-border bg-muted text-muted-foreground"
          }`}
        >
          {agent.status === "on" && <span className="size-1.5 rounded-full bg-green-500" />}
          {agent.status === "on" ? "On" : "Off"}
        </div>
      </div>

      {/* Description */}
      <p className="text-muted-foreground mt-2 line-clamp-1 text-[10px] leading-relaxed">
        {agent.description}
      </p>

      {/* Bottom row */}
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[8px] font-medium">
          {agent.trigger}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {agent.integrations.map((key) => (
            <img
              key={key}
              src={INTEGRATION_LOGOS[key]}
              alt=""
              width={12}
              height={12}
              loading="lazy"
              decoding="async"
              className="size-3"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   DEPARTMENT LABEL (on canvas)
   ═══════════════════════════════════════════════════════════════════════════════ */

function DeptLabel({ dept, isActive }: { dept: Department; isActive: boolean }) {
  return (
    <motion.div
      animate={{
        opacity: isActive ? 1 : 0.4,
        scale: isActive ? 1 : 0.95,
      }}
      transition={{ duration: 0.5 }}
      className="absolute"
      style={{ left: dept.labelX, top: dept.labelY }}
    >
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ backgroundColor: dept.color }} />
        <span className="text-foreground text-sm font-semibold tracking-tight">{dept.label}</span>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   DOT GRID BACKGROUND
   ═══════════════════════════════════════════════════════════════════════════════ */

function DotGrid() {
  return (
    <svg className="absolute inset-0 size-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" className="fill-muted-foreground/15" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   DEPARTMENT SELECTOR (bottom pills)
   ═══════════════════════════════════════════════════════════════════════════════ */

function DeptSelector({
  departments,
  activeIndex,
  onSelect,
}: {
  departments: Department[];
  activeIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const handleSelect = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const index = event.currentTarget.dataset.index;
      onSelect(index ? Number(index) : null);
    },
    [onSelect],
  );

  return (
    <div className="border-border/60 bg-background/80 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border px-1 py-1 shadow-sm backdrop-blur-md md:gap-1.5 md:px-2 md:py-1.5">
      <button
        type="button"
        onClick={handleSelect}
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all md:px-3 md:py-1 md:text-[11px] ${
          activeIndex === null
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        All
      </button>
      {departments.map((dept, i) => (
        <button
          key={dept.label}
          type="button"
          data-index={i}
          onClick={handleSelect}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all md:gap-1.5 md:px-3 md:py-1 md:text-[11px] ${
            activeIndex === i
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: dept.color }} />
          {dept.label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CANVAS — the animated org chart
   ═══════════════════════════════════════════════════════════════════════════════ */

// Canvas dimensions
const CANVAS_W = 1080;
const CANVAS_H = 440;

function getViewTransform(
  dept: Department | null,
  containerW: number,
  containerH: number,
): { x: number; y: number; scale: number } {
  if (!dept) {
    // Overview: fit entire canvas with padding
    const scaleX = containerW / CANVAS_W;
    const scaleY = containerH / CANVAS_H;
    const scale = Math.min(scaleX, scaleY) * 0.92;
    return {
      x: (containerW - CANVAS_W * scale) / 2,
      y: (containerH - CANVAS_H * scale) / 2,
      scale,
    };
  }

  // Zoom into department — scale relative to container
  const isMobile = containerW < 640;
  const scale = isMobile ? 0.85 : 1.25;
  return {
    x: containerW / 2 - dept.focusX * scale,
    y: containerH / 2 - dept.focusY * scale,
    scale,
  };
}

function OrgChartCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: false, margin: "-100px" });
  const [activeDeptIndex, setActiveDeptIndex] = useState<number | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 900, h: 520 });
  const cycleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualRef = useRef(false);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-cycle departments
  useEffect(() => {
    if (!isInView || manualRef.current) {
      return;
    }

    function cycle() {
      setActiveDeptIndex((prev) => {
        if (prev === null) {
          return 0;
        }
        if (prev >= DEPARTMENTS.length - 1) {
          return null;
        }
        return prev + 1;
      });
    }

    // Initial pause on overview, then start cycling
    const delay = activeDeptIndex === null ? OVERVIEW_PAUSE_MS : CYCLE_INTERVAL_MS;
    cycleRef.current = setTimeout(cycle, delay);

    return () => {
      if (cycleRef.current) {
        clearTimeout(cycleRef.current);
      }
    };
  }, [isInView, activeDeptIndex]);

  const handleManualSelect = useCallback((index: number | null) => {
    manualRef.current = true;
    setActiveDeptIndex(index);

    // Resume auto-cycle after 8s of inactivity
    if (cycleRef.current) {
      clearTimeout(cycleRef.current);
    }
    cycleRef.current = setTimeout(() => {
      manualRef.current = false;
    }, 8000);
  }, []);

  const activeDept = activeDeptIndex !== null ? (DEPARTMENTS[activeDeptIndex] ?? null) : null;
  const transform = getViewTransform(activeDept, containerSize.w, containerSize.h);

  return (
    <div
      ref={containerRef}
      className="bg-muted/40 border-border/80 relative h-[360px] w-full overflow-hidden rounded-2xl border md:h-[520px]"
    >
      <DotGrid />

      {/* Animated canvas layer */}
      <motion.div
        animate={{
          x: transform.x,
          y: transform.y,
          scale: transform.scale,
        }}
        transition={{
          duration: 1.2,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        className="absolute origin-top-left"
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        {/* Department labels */}
        {DEPARTMENTS.map((dept, i) => (
          <DeptLabel
            key={dept.label}
            dept={dept}
            isActive={activeDeptIndex === null || activeDeptIndex === i}
          />
        ))}

        {/* Agent cards */}
        {DEPARTMENTS.map((dept, deptIdx) =>
          dept.agents.map((agent) => (
            <MiniCard
              key={agent.username}
              agent={agent}
              isHighlighted={activeDeptIndex === null || activeDeptIndex === deptIdx}
            />
          )),
        )}
      </motion.div>

      {/* Department selector */}
      <DeptSelector
        departments={DEPARTMENTS}
        activeIndex={activeDeptIndex}
        onSelect={handleManualSelect}
      />

      {/* Vignette edges */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_40px_rgba(0,0,0,0.04)]" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SECTION EXPORT
   ═══════════════════════════════════════════════════════════════════════════════ */

export function OrgChartShowcaseSection() {
  return (
    <section className="bg-background border-border/40 border-t px-6 py-20 md:py-32">
      <div className="mx-auto max-w-6xl">
        {/* Header — centered for this visual-heavy section */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center md:mb-20"
        >
          <h2 className="text-foreground mx-auto max-w-2xl text-3xl font-bold tracking-tight md:text-[2.75rem] md:leading-[1.15]">
            Meet your new AI team
          </h2>
          <p className="text-muted-foreground mx-auto mt-4 max-w-lg text-base leading-relaxed">
            Every department powered by agents that run 24/7. No repetitive work left behind.
          </p>
        </motion.div>

        {/* Canvas */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
        >
          <OrgChartCanvas />
        </motion.div>
      </div>
    </section>
  );
}
