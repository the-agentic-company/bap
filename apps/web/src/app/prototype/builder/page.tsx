"use client";

// PROTOTYPE: Single builder layout for /prototype/builder with folders, chat, and instructions.
import {
  ChevronDown,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AgentStatus = "running" | "draft" | "ready" | "paused";

type Agent = {
  id: string;
  name: string;
  username: string;
  folderId: string;
  status: AgentStatus;
  trigger: string;
  edited: string;
  summary: string;
  prompt: string;
  tools: string[];
};

type ChatMessage = {
  id: string;
  from: "human" | "agent" | "system";
  text: string;
  time: string;
};

type FolderNode = {
  id: string;
  name: string;
  children?: FolderNode[];
};

const folders: FolderNode[] = [
  {
    id: "growth",
    name: "Growth",
    children: [
      { id: "growth/research", name: "Research" },
      { id: "growth/outreach", name: "Outreach" },
    ],
  },
  {
    id: "ops",
    name: "Operations",
    children: [
      { id: "ops/support", name: "Support" },
      { id: "ops/reporting", name: "Reporting" },
    ],
  },
  { id: "personal", name: "Personal" },
];

const agents: Agent[] = [
  {
    id: "market-scout",
    name: "Market Scout",
    username: "market-scout",
    folderId: "growth/research",
    status: "running",
    trigger: "Weekdays 08:00",
    edited: "2m ago",
    summary: "Tracks funding, hiring, and launch signals before account planning.",
    prompt:
      "Scan target accounts for public growth signals. Prepare a concise brief with source links, CRM context, and the next best owner action.",
    tools: ["HubSpot", "LinkedIn", "Perplexity"],
  },
  {
    id: "reply-drafter",
    name: "Reply Drafter",
    username: "reply-drafter",
    folderId: "growth/outreach",
    status: "draft",
    trigger: "Manual",
    edited: "14m ago",
    summary: "Turns account context into owner-reviewed follow-up drafts.",
    prompt:
      "Draft short follow-up emails using the account brief, recent thread context, and the workspace voice. Never send without approval.",
    tools: ["Gmail", "HubSpot"],
  },
  {
    id: "ticket-sentinel",
    name: "Ticket Sentinel",
    username: "ticket-sentinel",
    folderId: "ops/support",
    status: "ready",
    trigger: "Every hour",
    edited: "1h ago",
    summary: "Finds support tickets that need escalation or customer updates.",
    prompt:
      "Review open support tickets, detect stale threads, and summarize escalation candidates with suggested response owners.",
    tools: ["Linear", "Slack", "Zendesk"],
  },
  {
    id: "weekly-brief",
    name: "Weekly Brief",
    username: "weekly-brief",
    folderId: "ops/reporting",
    status: "paused",
    trigger: "Fridays 16:00",
    edited: "Yesterday",
    summary: "Compiles run outcomes, blockers, and open approvals for leadership.",
    prompt:
      "Collect coworker activity from the week. Summarize completed work, blocked work, and decisions waiting on a human.",
    tools: ["Slack", "Notion"],
  },
  {
    id: "inbox-zero",
    name: "Inbox Zero",
    username: "inbox-zero",
    folderId: "personal",
    status: "ready",
    trigger: "Manual",
    edited: "May 30",
    summary: "Sorts personal inbox tasks into reply, read later, and ignore buckets.",
    prompt:
      "Classify unread email into practical next actions. Draft replies only for threads that clearly need a response.",
    tools: ["Gmail", "Calendar"],
  },
];

const chatByAgent: Record<string, ChatMessage[]> = {
  "market-scout": [
    {
      id: "market-system",
      from: "system",
      text: "Market Scout finished the account signal scan and attached source notes.",
      time: "08:14",
    },
    {
      id: "market-human",
      from: "human",
      text: "Show me the accounts with active opportunities first.",
      time: "08:15",
    },
    {
      id: "market-agent",
      from: "agent",
      text: "Northstar Bio and Arcworks both changed hiring velocity this week. Northstar has no next step in HubSpot, so I would start there.",
      time: "08:16",
    },
  ],
  "reply-drafter": [
    {
      id: "reply-system",
      from: "system",
      text: "Reply Drafter is waiting on owner approval before drafting outbound copy.",
      time: "09:02",
    },
    {
      id: "reply-human",
      from: "human",
      text: "Use the short version for accounts we spoke with last week.",
      time: "09:03",
    },
    {
      id: "reply-agent",
      from: "agent",
      text: "Understood. I will keep the opening under two sentences and include only one ask.",
      time: "09:03",
    },
  ],
  "ticket-sentinel": [
    {
      id: "ticket-system",
      from: "system",
      text: "Ticket Sentinel found four support threads without a customer-facing update.",
      time: "10:41",
    },
    {
      id: "ticket-human",
      from: "human",
      text: "Which ones need escalation before the next hourly run?",
      time: "10:42",
    },
    {
      id: "ticket-agent",
      from: "agent",
      text: "Two should be escalated: the OAuth callback failure for Acme and the sandbox timeout for Beacon. I drafted Slack handoff notes for both.",
      time: "10:43",
    },
  ],
  "weekly-brief": [
    {
      id: "brief-system",
      from: "system",
      text: "Weekly Brief is paused. The last digest was generated on Friday.",
      time: "Fri",
    },
    {
      id: "brief-human",
      from: "human",
      text: "When we resume, separate customer blockers from internal cleanup.",
      time: "Fri",
    },
    {
      id: "brief-agent",
      from: "agent",
      text: "I will split the report into customer blockers, internal work, and decisions waiting on a human.",
      time: "Fri",
    },
  ],
  "inbox-zero": [
    {
      id: "inbox-system",
      from: "system",
      text: "Inbox Zero has a draft classification plan ready.",
      time: "May 30",
    },
    {
      id: "inbox-human",
      from: "human",
      text: "Ignore newsletters unless they mention billing, security, or a meeting change.",
      time: "May 30",
    },
    {
      id: "inbox-agent",
      from: "agent",
      text: "Got it. I will only surface newsletters when they change your schedule, account risk, or payment status.",
      time: "May 30",
    },
  ],
};

const statusCopy: Record<AgentStatus, string> = {
  running: "Running",
  draft: "Draft",
  ready: "Ready",
  paused: "Paused",
};

const statusClassName: Record<AgentStatus, string> = {
  running: "bg-blue-500",
  draft: "bg-amber-500",
  ready: "bg-green-500",
  paused: "bg-muted-foreground",
};

function getFolderName(folderId: string) {
  const stack = [...folders];
  while (stack.length > 0) {
    const folder = stack.shift();
    if (!folder) {
      continue;
    }
    if (folder.id === folderId) {
      return folder.name;
    }
    stack.push(...(folder.children ?? []));
  }
  return folderId;
}

function getDescendantFolderIds(folder: FolderNode): string[] {
  return [folder.id, ...(folder.children ?? []).flatMap(getDescendantFolderIds)];
}

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", statusClassName[status])} />
      {statusCopy[status]}
    </span>
  );
}

function AgentCard({
  agent,
  selected,
  onSelect,
  compact = false,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const handleSelect = useCallback(() => onSelect(agent.id), [agent.id, onSelect]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      className={cn(
        "group w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/30",
        selected && "border-foreground/25 bg-muted/50 shadow-none",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <CoworkerAvatar username={agent.username} size={compact ? 30 : 36} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{agent.name}</p>
            <MoreHorizontal className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {getFolderName(agent.folderId)}
          </p>
        </div>
      </div>
      {!compact ? (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{agent.summary}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusBadge status={agent.status} />
        <span className="text-[11px] text-muted-foreground">{agent.edited}</span>
      </div>
    </button>
  );
}

function FolderCard({
  folder,
  selectedAgentId,
  onSelectAgent,
  defaultOpen = false,
  level = 0,
}: {
  folder: FolderNode;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  defaultOpen?: boolean;
  level?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggleOpen = useCallback(() => setOpen((value) => !value), []);
  const nestedFolderIds = useMemo(() => getDescendantFolderIds(folder), [folder]);
  const directAgents = agents.filter((agent) => agent.folderId === folder.id);
  const nestedCount = agents.filter((agent) => nestedFolderIds.includes(agent.folderId)).length;
  const Icon = open ? FolderOpen : Folder;

  return (
    <section
      className={cn("rounded-lg border border-border bg-background p-2", level > 0 && "ml-3")}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/40"
      >
        <Icon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {nestedCount}
        </span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {directAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedAgentId}
              onSelect={onSelectAgent}
              compact={level > 0}
            />
          ))}
          {(folder.children ?? []).map((child) => (
            <FolderCard
              key={child.id}
              folder={child}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              defaultOpen={nestedFolderIds.some((id) =>
                agents.some((agent) => agent.folderId === id && agent.id === selectedAgentId),
              )}
              level={level + 1}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChatPanel({ agent }: { agent: Agent }) {
  const messages = chatByAgent[agent.id] ?? [];

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-background">
      <div className="border-b border-border/50 bg-card px-5 py-4">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <CoworkerAvatar username={agent.username} size={40} className="rounded-xl" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight">{agent.name}</h1>
                <StatusBadge status={agent.status} />
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{agent.summary}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm">
            <Play className="size-4" />
            Run
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-5">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Builder chat</h2>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Mock conversation for editing, testing, and comparing this coworker before changing the
            instruction panel.
          </p>
        </div>

        {messages.map((message) => (
          <article
            key={message.id}
            className={cn(
              "max-w-[78%] rounded-lg border px-4 py-3 text-sm leading-6 shadow-sm",
              message.from === "human" &&
                "ml-auto border-foreground/10 bg-foreground text-background",
              message.from === "agent" && "border-border bg-card",
              message.from === "system" &&
                "mx-auto max-w-[88%] border-dashed bg-muted/40 text-muted-foreground",
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-medium opacity-70">
              <span>
                {message.from === "human"
                  ? "You"
                  : message.from === "agent"
                    ? agent.name
                    : "Run note"}
              </span>
              <span>{message.time}</span>
            </div>
            <p>{message.text}</p>
          </article>
        ))}
      </div>

      <div className="border-t border-border/50 bg-card p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={`Ask ${agent.name} about the latest run...`}
            readOnly
            className="min-h-20 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground outline-none"
          />
          <Button type="button" size="icon" aria-label="Send mock message">
            <MessageSquare className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

function InstructionPanel({ agent }: { agent: Agent }) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border/50 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SquarePen className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Instructions</h2>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {getFolderName(agent.folderId)} / {agent.trigger}
            </p>
          </div>
          <Button type="button" size="sm">
            <Save className="size-4" />
            Save
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <textarea
          value={agent.prompt}
          readOnly
          className="min-h-[300px] w-full resize-none rounded-md border border-input bg-background p-3 text-sm leading-6 text-foreground shadow-inner outline-none"
        />

        <section className="rounded-lg border border-border bg-background p-3">
          <div className="mb-3 flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">State</h3>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">variant</dt>
              <dd className="font-mono text-xs">cards</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">selected.agent</dt>
              <dd className="font-mono text-xs">{agent.id}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">selected.folder</dt>
              <dd className="font-mono text-xs">{agent.folderId}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-background p-3">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Tools</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map((tool) => (
              <span
                key={tool}
                className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
              >
                {tool}
              </span>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function BuilderWorkPanels({ agent }: { agent: Agent }) {
  return (
    <div className="grid min-h-screen min-w-0 grid-cols-[minmax(420px,1fr)_380px] bg-background">
      <ChatPanel agent={agent} />
      <InstructionPanel agent={agent} />
    </div>
  );
}

function VariantCards({
  selectedAgent,
  selectedAgentId,
  onSelectAgent,
}: {
  selectedAgent: Agent;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <div className="flex min-h-screen min-w-[1180px] overflow-x-auto bg-muted/25">
      <aside className="flex w-[370px] shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Builder
              </p>
              <h2 className="mt-1 text-lg font-semibold">Agents by folder</h2>
            </div>
            <Button type="button" size="icon" variant="outline" aria-label="Add folder">
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search agents or folders" readOnly />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              defaultOpen
            />
          ))}
        </div>
      </aside>
      <BuilderWorkPanels agent={selectedAgent} />
    </div>
  );
}

export default function BuilderPrototypePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedAgentId = searchParams.get("agent");
  const selectedAgent = agents.find((agent) => agent.id === requestedAgentId) ?? agents[0];

  const selectAgent = useCallback(
    (agentId: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("agent", agentId);
      router.replace(`${pathname}?${nextParams.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return (
    <VariantCards
      selectedAgent={selectedAgent}
      selectedAgentId={selectedAgent.id}
      onSelectAgent={selectAgent}
    />
  );
}
