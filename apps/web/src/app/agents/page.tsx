"use client";

import type { CoworkerToolAccessMode } from "@cmdclaw/core/lib/coworker-tool-policy";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Clock,
  Download,
  Eye,
  Filter,
  Folder,
  FolderOpen,
  History,
  Loader2,
  Mail,
  Menu,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Search,
  Share2,
  Upload,
  Webhook,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { ViewTabs } from "@/components/coworkers/view-tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";
import {
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  type IntegrationType,
} from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import {
  useCoworkerList,
  useCoworkerFolderList,
  useCoworkerViewList,
  useCreateCoworkerFolderPath,
  useImportCoworkerDefinition,
  useImportSharedCoworker,
  useIntegrationList,
  useMoveCoworkerToFolder,
  useSharedCoworkerList,
} from "@/orpc/hooks";
import CoworkerEditorPage from "../coworkers/[id]/coworker-editor-page";

type AgentItem = {
  id: string;
  name?: string | null;
  username?: string | null;
  description?: string | null;
  folderId?: string | null;
  status: "on" | "off";
  triggerType: string;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations?: IntegrationType[];
  allowedSkillSlugs?: string[];
  recentRuns?: {
    id: string;
    status: string;
    startedAt?: Date | string | null;
    conversationId?: string | null;
    source?: string;
  }[];
  isPinned?: boolean;
  sharedAt?: Date | string | null;
  tags?: { id: string; name: string; color: string | null }[];
};

type SharedAgentItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  triggerType: string;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations?: IntegrationType[];
  allowedSkillSlugs?: string[];
  prompt?: string | null;
  owner: {
    name?: string | null;
    email?: string | null;
  };
  sharedAt?: Date | string | null;
  documentCount: number;
  isOwnedByCurrentUser: boolean;
};

type FolderTag = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
};

type AgentFolderNode = {
  id: string;
  name: string;
  path: string;
  children: AgentFolderNode[];
  agents: AgentItem[];
};

const TRIGGER_TYPE_OPTIONS = [
  { value: "manual", label: "Manual", icon: Play },
  { value: "schedule", label: "Scheduled", icon: Clock },
  { value: "email", label: "Email", icon: Mail },
  { value: "webhook", label: "Webhook", icon: Webhook },
] as const;

const CARD_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" },
} as const;

function formatDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
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

function getTriggerLabel(triggerType: string) {
  const match = TRIGGER_TYPE_OPTIONS.find((entry) => entry.value === triggerType);
  return match?.label ?? triggerType;
}

function buildToolSummary(
  agent: Pick<
    AgentItem | SharedAgentItem,
    "toolAccessMode" | "allowedIntegrations" | "allowedSkillSlugs"
  >,
  connectedIntegrationTypes: IntegrationType[],
) {
  const integrationTypes =
    agent.toolAccessMode === "all"
      ? connectedIntegrationTypes
      : (agent.allowedIntegrations ?? []).filter((entry) =>
          COWORKER_AVAILABLE_INTEGRATION_TYPES.includes(entry),
        );
  const skillCount =
    agent.toolAccessMode === "selected" ? (agent.allowedSkillSlugs?.length ?? 0) : 0;

  return {
    visibleIntegrations: integrationTypes.slice(0, 4),
    skillCount,
    overflowCount: Math.max(0, integrationTypes.length + skillCount - 4),
  };
}

function normalizeFolderPath(value: string) {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function createEmptyFolderNode(path: string): AgentFolderNode {
  const parts = path.split("/");
  return {
    id: path,
    name: parts.at(-1) ?? path,
    path,
    children: [],
    agents: [],
  };
}

function buildAgentFolderTree(agents: AgentItem[], folderTags: FolderTag[]) {
  const nodeByPath = new Map<string, AgentFolderNode>();
  const nodeById = new Map<string, AgentFolderNode>();
  const rootNodes: AgentFolderNode[] = [];
  const unfiled: AgentItem[] = [];

  function ensureNode(folder: FolderTag) {
    const existing = nodeById.get(folder.id);
    if (existing) {
      return existing;
    }

    const node = createEmptyFolderNode(folder.path);
    node.id = folder.id;
    node.name = folder.name;
    nodeByPath.set(folder.path, node);
    nodeById.set(folder.id, node);

    const parentFolder = folder.parentId
      ? folderTags.find((candidate) => candidate.id === folder.parentId)
      : null;
    if (parentFolder) {
      ensureNode(parentFolder).children.push(node);
    } else {
      rootNodes.push(node);
    }

    return node;
  }

  for (const tag of folderTags) {
    ensureNode(tag);
  }

  for (const agent of agents) {
    if (!agent.folderId) {
      unfiled.push(agent);
      continue;
    }

    const node = nodeById.get(agent.folderId);
    if (!node) {
      unfiled.push(agent);
      continue;
    }
    node.agents.push(agent);
  }

  const sortNode = (node: AgentFolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.agents.sort((a, b) =>
      getCoworkerDisplayName(a.name).localeCompare(getCoworkerDisplayName(b.name)),
    );
    node.children.forEach(sortNode);
  };

  rootNodes.sort((a, b) => a.name.localeCompare(b.name));
  rootNodes.forEach(sortNode);
  unfiled.sort((a, b) =>
    getCoworkerDisplayName(a.name).localeCompare(getCoworkerDisplayName(b.name)),
  );

  return { rootNodes, unfiled };
}

function AgentStatusBadge({ status }: { status: AgentItem["status"] }) {
  const isOn = status === "on";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium",
        isOn
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", isOn ? "bg-emerald-500" : "bg-muted-foreground/50")}
      />
      {isOn ? "On" : "Off"}
    </span>
  );
}

function AgentListCard({
  agent,
  selected,
  connectedIntegrationTypes,
  folderTags,
  onSelect,
  onMoveToFolder,
}: {
  agent: AgentItem;
  selected: boolean;
  connectedIntegrationTypes: IntegrationType[];
  folderTags: FolderTag[];
  onSelect: (id: string) => void;
  onMoveToFolder: (agent: AgentItem, folderTagId: string | null) => void;
}) {
  const handleSelect = useCallback(() => onSelect(agent.id), [agent.id, onSelect]);
  const currentFolderId = folderTags.some((folder) => folder.id === agent.folderId)
    ? agent.folderId
    : null;
  const summary = useMemo(
    () => buildToolSummary(agent, connectedIntegrationTypes),
    [agent, connectedIntegrationTypes],
  );
  const recentRun = agent.recentRuns?.[0];
  const handleFolderChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      event.stopPropagation();
      onMoveToFolder(agent, event.target.value === "__unfiled" ? null : event.target.value);
    },
    [agent, onMoveToFolder],
  );
  const handleFolderClick = useCallback((event: React.MouseEvent<HTMLSelectElement>) => {
    event.stopPropagation();
  }, []);
  const handleMenuClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);
  const handleOpenFromMenu = useCallback(() => {
    onSelect(agent.id);
  }, [agent.id, onSelect]);
  const handleMoveToUnfiled = useCallback(() => {
    onMoveToFolder(agent, null);
  }, [agent, onMoveToFolder]);
  const handleMoveToFolderFromMenu = useCallback(
    (event: Event) => {
      const folderId = (event.currentTarget as HTMLElement).dataset.folderId;
      if (folderId) {
        onMoveToFolder(agent, folderId);
      }
    },
    [agent, onMoveToFolder],
  );
  return (
    <div
      className={cn(
        "group w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/30",
        selected && "border-foreground/25 bg-muted/50 shadow-none",
      )}
    >
      <button type="button" onClick={handleSelect} className="w-full text-left outline-none">
        <div className="flex min-w-0 items-start gap-3">
          <CoworkerAvatar
            username={agent.username ?? agent.name}
            size={36}
            className="rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{getCoworkerDisplayName(agent.name)}</p>
              <div className="flex shrink-0 items-center gap-1">
                <AgentStatusBadge status={agent.status} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={handleMenuClick}
                      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 items-center justify-center rounded-md opacity-0 transition-colors group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label={`${getCoworkerDisplayName(agent.name)} actions`}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56" onClick={handleMenuClick}>
                    <DropdownMenuItem onSelect={handleOpenFromMenu}>Open</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
                      Move to folder
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={handleMoveToUnfiled}
                      disabled={currentFolderId === null}
                    >
                      <Folder className="size-4" />
                      Unfiled
                    </DropdownMenuItem>
                    {folderTags.map((folder) => (
                      <DropdownMenuItem
                        key={folder.id}
                        data-folder-id={folder.id}
                        onSelect={handleMoveToFolderFromMenu}
                        disabled={folder.id === currentFolderId}
                      >
                        <Folder className="size-4" />
                        <span className="truncate">{folder.path}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {getTriggerLabel(agent.triggerType)}
              {recentRun ? ` · ${getCoworkerRunStatusLabel(recentRun.status)}` : " · no runs"}
            </p>
          </div>
        </div>

        {agent.description ? (
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {agent.description}
          </p>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {summary.visibleIntegrations.map((key) => {
              const logo = INTEGRATION_LOGOS[key];
              if (!logo) {
                return null;
              }
              return (
                <Image
                  key={key}
                  src={logo}
                  alt={INTEGRATION_DISPLAY_NAMES[key] ?? key}
                  width={14}
                  height={14}
                  className="size-3.5 shrink-0"
                  title={INTEGRATION_DISPLAY_NAMES[key] ?? key}
                />
              );
            })}
            {summary.skillCount > 0 ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {summary.skillCount} skill{summary.skillCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {summary.overflowCount > 0 ? (
              <span className="text-[10px] font-medium text-muted-foreground">
                +{summary.overflowCount}
              </span>
            ) : null}
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatDate(recentRun?.startedAt) ?? "Not run"}
          </span>
        </div>
      </button>
      <div className="mt-3">
        <select
          value={currentFolderId ?? "__unfiled"}
          onChange={handleFolderChange}
          onClick={handleFolderClick}
          className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus:border-ring"
          aria-label={`Move ${getCoworkerDisplayName(agent.name)} to folder`}
        >
          <option value="__unfiled">Unfiled</option>
          {folderTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.path}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AgentFolderTree({
  nodes,
  selectedAgentId,
  connectedIntegrationTypes,
  folderTags,
  onSelectAgent,
  onMoveToFolder,
  level = 0,
}: {
  nodes: AgentFolderNode[];
  selectedAgentId?: string;
  connectedIntegrationTypes: IntegrationType[];
  folderTags: FolderTag[];
  onSelectAgent: (id: string) => void;
  onMoveToFolder: (agent: AgentItem, folderTagId: string | null) => void;
  level?: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <AgentFolderSection
          key={node.id}
          node={node}
          selectedAgentId={selectedAgentId}
          connectedIntegrationTypes={connectedIntegrationTypes}
          folderTags={folderTags}
          onSelectAgent={onSelectAgent}
          onMoveToFolder={onMoveToFolder}
          level={level}
        />
      ))}
    </>
  );
}

function AgentFolderSection({
  node,
  selectedAgentId,
  connectedIntegrationTypes,
  folderTags,
  onSelectAgent,
  onMoveToFolder,
  level,
}: {
  node: AgentFolderNode;
  selectedAgentId?: string;
  connectedIntegrationTypes: IntegrationType[];
  folderTags: FolderTag[];
  onSelectAgent: (id: string) => void;
  onMoveToFolder: (agent: AgentItem, folderTagId: string | null) => void;
  level: number;
}) {
  const [open, setOpen] = useState(true);
  const toggleOpen = useCallback(() => setOpen((value) => !value), []);
  const nestedCount = useMemo(() => {
    const countAgents = (folder: AgentFolderNode): number =>
      folder.agents.length +
      folder.children.reduce((count, child) => count + countAgents(child), 0);
    return countAgents(node);
  }, [node]);
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
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {nestedCount}
        </span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {node.agents.map((agent) => (
            <AgentListCard
              key={`${node.id}:${agent.id}`}
              agent={agent}
              selected={agent.id === selectedAgentId}
              connectedIntegrationTypes={connectedIntegrationTypes}
              folderTags={folderTags}
              onSelect={onSelectAgent}
              onMoveToFolder={onMoveToFolder}
            />
          ))}
          <AgentFolderTree
            nodes={node.children}
            selectedAgentId={selectedAgentId}
            connectedIntegrationTypes={connectedIntegrationTypes}
            folderTags={folderTags}
            onSelectAgent={onSelectAgent}
            onMoveToFolder={onMoveToFolder}
            level={level + 1}
          />
        </div>
      ) : null}
    </section>
  );
}

function SharedAgentCard({
  agent,
  connectedIntegrationTypes,
  isImporting,
  onImport,
}: {
  agent: SharedAgentItem;
  connectedIntegrationTypes: IntegrationType[];
  isImporting: boolean;
  onImport: (id: string) => void;
}) {
  const handleImport = useCallback(() => onImport(agent.id), [agent.id, onImport]);
  const summary = useMemo(
    () => buildToolSummary(agent, connectedIntegrationTypes),
    [agent, connectedIntegrationTypes],
  );

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start gap-3">
        <CoworkerAvatar username={agent.name} size={34} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{getCoworkerDisplayName(agent.name)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent.owner.name?.trim() || agent.owner.email || "A teammate"}
          </p>
        </div>
      </div>
      {agent.description ? (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {agent.description}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-1.5">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {getTriggerLabel(agent.triggerType)}
        </span>
        {summary.visibleIntegrations.map((key) => {
          const logo = INTEGRATION_LOGOS[key];
          if (!logo) {
            return null;
          }
          return (
            <Image
              key={key}
              src={logo}
              alt={INTEGRATION_DISPLAY_NAMES[key] ?? key}
              width={14}
              height={14}
              className="size-3.5 shrink-0"
              title={INTEGRATION_DISPLAY_NAMES[key] ?? key}
            />
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleImport}
          disabled={isImporting}
        >
          {isImporting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Download className="size-3" />
          )}
          Install
        </Button>
        {agent.prompt ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <Eye className="size-3" />
                Instructions
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{getCoworkerDisplayName(agent.name)}</DialogTitle>
                <DialogDescription>
                  Shared by {agent.owner.name?.trim() || agent.owner.email || "a teammate"}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[400px] overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {agent.prompt}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedAgentId = searchParams.get("agent");
  const { data: coworkers, isLoading } = useCoworkerList();
  const { data: sharedCoworkers } = useSharedCoworkerList();
  const { data: integrations } = useIntegrationList();
  const { data: views } = useCoworkerViewList();
  const { data: folders } = useCoworkerFolderList();
  const createFolder = useCreateCoworkerFolderPath();
  const moveToFolder = useMoveCoworkerToFolder();
  const importCoworkerDefinition = useImportCoworkerDefinition();
  const importSharedCoworker = useImportSharedCoworker();
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [selectedTriggerTypes, setSelectedTriggerTypes] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [importingSharedAgentId, setImportingSharedAgentId] = useState<string | null>(null);

  const openRecentDrawer = useCallback(() => {
    window.dispatchEvent(new CustomEvent(COWORKERS_OPEN_RECENT_DRAWER_EVENT));
  }, []);

  const agentList = useMemo(() => {
    const real = Array.isArray(coworkers) ? coworkers : [];
    return real.map((entry) =>
      Object.assign({}, entry, {
        toolAccessMode: entry.toolAccessMode,
        allowedIntegrations: (entry.allowedIntegrations ?? []) as IntegrationType[],
        allowedSkillSlugs: entry.allowedSkillSlugs ?? [],
      }),
    ) as AgentItem[];
  }, [coworkers]);

  const connectedIntegrationTypes = useMemo(
    () =>
      (integrations ?? []).flatMap((entry) =>
        entry.enabled &&
        entry.setupRequired !== true &&
        COWORKER_AVAILABLE_INTEGRATION_TYPES.includes(entry.type as IntegrationType)
          ? ([entry.type as IntegrationType] as const)
          : [],
      ),
    [integrations],
  );

  const folderTags = useMemo(() => {
    const folderList = folders ?? [];
    const byId = new Map(folderList.map((folder) => [folder.id, folder]));
    const getPath = (folder: (typeof folderList)[number]): string => {
      if (!folder.parentId) {
        return normalizeFolderPath(folder.name);
      }
      const parent = byId.get(folder.parentId);
      if (!parent) {
        return normalizeFolderPath(folder.name);
      }
      return normalizeFolderPath(`${getPath(parent)}/${folder.name}`);
    };

    return folderList
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        path: getPath(folder),
      }))
      .filter((tag) => tag.path.length > 0)
      .toSorted((a, b) => a.path.localeCompare(b.path));
  }, [folders]);

  const sharedAgentList = useMemo(
    () =>
      (sharedCoworkers ?? []).filter((entry) => !entry.isOwnedByCurrentUser) as SharedAgentItem[],
    [sharedCoworkers],
  );

  const selectedAgent = useMemo(
    () => agentList.find((agent) => agent.id === selectedAgentId) ?? agentList[0],
    [agentList, selectedAgentId],
  );

  useEffect(() => {
    if (!selectedAgent || selectedAgentId === selectedAgent.id) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("agent", selectedAgent.id);
    router.replace(`/agents?${nextParams.toString()}`);
  }, [router, searchParams, selectedAgent, selectedAgentId]);

  const displayedAgentList = useMemo(() => {
    let list = agentList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (agent) =>
          agent.name?.toLowerCase().includes(q) ||
          agent.username?.toLowerCase().includes(q) ||
          agent.description?.toLowerCase().includes(q),
      );
    }
    if (selectedTagIds.size > 0) {
      list = list.filter((agent) => (agent.tags ?? []).some((tag) => selectedTagIds.has(tag.id)));
    }
    if (selectedTriggerTypes.size > 0) {
      list = list.filter((agent) => selectedTriggerTypes.has(agent.triggerType));
    }
    return list;
  }, [agentList, searchQuery, selectedTagIds, selectedTriggerTypes]);

  const agentTree = useMemo(
    () => buildAgentFolderTree(displayedAgentList, folderTags),
    [displayedAgentList, folderTags],
  );
  const unfiledFolderNode = useMemo(
    () => ({
      id: "__unfiled",
      name: "Unfiled",
      path: "Unfiled",
      children: [],
      agents: agentTree.unfiled,
    }),
    [agentTree.unfiled],
  );

  const displayedSharedAgentList = useMemo(() => {
    if (!searchQuery.trim()) {
      return sharedAgentList;
    }
    const q = searchQuery.toLowerCase();
    return sharedAgentList.filter(
      (agent) =>
        agent.name?.toLowerCase().includes(q) || agent.description?.toLowerCase().includes(q),
    );
  }, [sharedAgentList, searchQuery]);

  const currentFilters = useMemo(
    () => ({
      tagIds: selectedTagIds.size > 0 ? [...selectedTagIds] : undefined,
      triggerTypes: selectedTriggerTypes.size > 0 ? [...selectedTriggerTypes] : undefined,
    }),
    [selectedTagIds, selectedTriggerTypes],
  );

  const hasActiveFilters = selectedTagIds.size > 0 || selectedTriggerTypes.size > 0;

  const selectAgent = useCallback(
    (agentId: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("agent", agentId);
      router.replace(`/agents?${nextParams.toString()}`);
    },
    [router, searchParams],
  );

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value),
    [],
  );

  const handleNewFolderNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setNewFolderName(event.target.value);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    const path = normalizeFolderPath(newFolderName);
    if (!path || createFolder.isPending) {
      return;
    }

    try {
      await createFolder.mutateAsync({ path });
      setNewFolderName("");
      setIsNewFolderDialogOpen(false);
      toast.success("Folder created.");
    } catch (error) {
      console.error("Failed to create folder:", error);
      toast.error("Failed to create folder.");
    }
  }, [createFolder, newFolderName]);

  const handleNewFolderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        void handleCreateFolder();
      }
    },
    [handleCreateFolder],
  );

  const handleMoveToFolder = useCallback(
    async (agent: AgentItem, folderTagId: string | null) => {
      if ((agent.folderId ?? null) === folderTagId) {
        return;
      }

      try {
        await moveToFolder.mutateAsync({ coworkerId: agent.id, folderId: folderTagId });
        toast.success("Agent moved.");
      } catch (error) {
        console.error("Failed to move agent:", error);
        toast.error("Failed to move agent.");
      }
    },
    [moveToFolder],
  );

  const handleToggleTagFilter = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
    setActiveViewId(null);
  }, []);

  const handleToggleTriggerType = useCallback((triggerType: string) => {
    setSelectedTriggerTypes((prev) => {
      const next = new Set(prev);
      if (next.has(triggerType)) {
        next.delete(triggerType);
      } else {
        next.add(triggerType);
      }
      return next;
    });
    setActiveViewId(null);
  }, []);

  const handleTriggerTypeButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const triggerType = event.currentTarget.dataset.triggerType;
      if (triggerType) {
        handleToggleTriggerType(triggerType);
      }
    },
    [handleToggleTriggerType],
  );

  const handleClearAllFilters = useCallback(() => {
    setSelectedTagIds(new Set());
    setSelectedTriggerTypes(new Set());
    setActiveViewId(null);
  }, []);

  const handleSelectView = useCallback(
    (viewId: string | null) => {
      setActiveViewId(viewId);
      if (viewId === null) {
        setSelectedTagIds(new Set());
        setSelectedTriggerTypes(new Set());
        return;
      }

      const view = (views ?? []).find((entry) => entry.id === viewId);
      if (!view) {
        return;
      }
      const filters = view.filters as { tagIds?: string[]; triggerTypes?: string[] };
      setSelectedTagIds(new Set(filters.tagIds ?? []));
      setSelectedTriggerTypes(new Set(filters.triggerTypes ?? []));
    },
    [views],
  );

  const handleImportAgentClick = useCallback(() => {
    if (!importCoworkerDefinition.isPending) {
      importFileInputRef.current?.click();
    }
  }, [importCoworkerDefinition.isPending]);

  const handleImportAgentFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith(".json")) {
        toast.error("Select a .json agent export.");
        return;
      }

      try {
        const definitionJson = await file.text();
        const created = await importCoworkerDefinition.mutateAsync(definitionJson);
        toast.success("Agent imported in the off state.");
        router.push(`/coworkers/${created.id}`);
      } catch (error) {
        console.error("Failed to import agent definition:", error);
        toast.error("Failed to import agent.");
      }
    },
    [importCoworkerDefinition, router],
  );

  const handleImportSharedAgent = useCallback(
    async (sourceCoworkerId: string) => {
      setImportingSharedAgentId(sourceCoworkerId);
      try {
        const created = await importSharedCoworker.mutateAsync(sourceCoworkerId);
        toast.success("Agent installed.");
        router.push(`/coworkers/${created.id}`);
      } catch (error) {
        console.error("Failed to install shared agent:", error);
        toast.error("Failed to install agent.");
      } finally {
        setImportingSharedAgentId(null);
      }
    },
    [importSharedCoworker, router],
  );

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-auto bg-muted/25">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Agents
              </p>
              <h2 className="mt-1 text-lg font-semibold">Workspace agents</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={openRecentDrawer}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground md:hidden"
                aria-label="Recent runs"
              >
                <Menu className="size-4" />
              </button>
              <Dialog open={isNewFolderDialogOpen} onOpenChange={setIsNewFolderDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" size="icon" variant="outline" aria-label="Create folder">
                    <Folder className="size-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Create folder</DialogTitle>
                    <DialogDescription>
                      Use slashes for nesting, for example Growth/Research.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Input
                      value={newFolderName}
                      onChange={handleNewFolderNameChange}
                      onKeyDown={handleNewFolderKeyDown}
                      placeholder="Operations/Support"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={handleCreateFolder}
                        disabled={!normalizeFolderPath(newFolderName) || createFolder.isPending}
                      >
                        {createFolder.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Folder className="size-4" />
                        )}
                        Create
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Button type="button" size="icon" variant="outline" asChild aria-label="Create agent">
                <Link href="/">
                  <Plus className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-9"
                placeholder="Search agents"
              />
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                      selectedTriggerTypes.size > 0
                        ? "border-foreground/20 bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Filter className="size-3" />
                    Trigger
                    {selectedTriggerTypes.size > 0 ? (
                      <span className="rounded bg-background/20 px-1 text-[10px] tabular-nums">
                        {selectedTriggerTypes.size}
                      </span>
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-40 p-1.5">
                  <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Trigger
                  </p>
                  {TRIGGER_TYPE_OPTIONS.map((trigger) => {
                    const isActive = selectedTriggerTypes.has(trigger.value);
                    const Icon = trigger.icon;
                    return (
                      <button
                        key={trigger.value}
                        type="button"
                        data-trigger-type={trigger.value}
                        onClick={handleTriggerTypeButtonClick}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                      >
                        <div
                          className={cn(
                            "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                            isActive
                              ? "border-brand bg-brand text-primary-foreground"
                              : "border-input bg-transparent",
                          )}
                        >
                          {isActive ? <X className="size-2.5" /> : null}
                        </div>
                        <Icon className="size-3 text-muted-foreground" />
                        <span className="text-foreground">{trigger.label}</span>
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>

              <input
                ref={importFileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Import agent JSON file"
                onChange={handleImportAgentFileChange}
              />
              <button
                type="button"
                onClick={handleImportAgentClick}
                disabled={importCoworkerDefinition.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {importCoworkerDefinition.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Upload className="size-3" />
                )}
                Import
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-border/50 px-3 py-2">
          <ViewTabs
            activeViewId={activeViewId}
            onSelectView={handleSelectView}
            currentFilters={currentFilters}
            hasActiveFilters={hasActiveFilters}
            selectedTagIds={selectedTagIds}
            onToggleTag={handleToggleTagFilter}
            onClearAll={handleClearAllFilters}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : agentList.length === 0 && !searchQuery.trim() ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <Image src="/tools/lobster.svg" alt="" width={56} height={56} className="mb-5" />
              <h2 className="text-base font-semibold">Build your first agent</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Put repetitive tasks on autopilot.
              </p>
              <Button type="button" className="mt-5" asChild>
                <Link href="/">
                  <Plus className="size-4" />
                  Start building
                </Link>
              </Button>
            </div>
          ) : displayedAgentList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">No agents match the current filters.</p>
            </div>
          ) : (
            <motion.div layout className="space-y-3">
              <AnimatePresence mode="popLayout">
                {agentTree.rootNodes.length > 0 ? (
                  <motion.div
                    key="folders"
                    layout
                    initial={CARD_MOTION.initial}
                    animate={CARD_MOTION.animate}
                    exit={CARD_MOTION.exit}
                    transition={CARD_MOTION.transition}
                    className="space-y-3"
                  >
                    <AgentFolderTree
                      nodes={agentTree.rootNodes}
                      selectedAgentId={selectedAgent?.id}
                      connectedIntegrationTypes={connectedIntegrationTypes}
                      folderTags={folderTags}
                      onSelectAgent={selectAgent}
                      onMoveToFolder={handleMoveToFolder}
                    />
                  </motion.div>
                ) : null}
                {agentTree.unfiled.length > 0 ? (
                  <motion.div
                    key="unfiled"
                    layout
                    initial={CARD_MOTION.initial}
                    animate={CARD_MOTION.animate}
                    exit={CARD_MOTION.exit}
                    transition={CARD_MOTION.transition}
                  >
                    <AgentFolderSection
                      node={unfiledFolderNode}
                      selectedAgentId={selectedAgent?.id}
                      connectedIntegrationTypes={connectedIntegrationTypes}
                      folderTags={folderTags}
                      onSelectAgent={selectAgent}
                      onMoveToFolder={handleMoveToFolder}
                      level={0}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}

          {displayedSharedAgentList.length > 0 ? (
            <section className="space-y-3 pt-2">
              <div className="flex items-center gap-2 px-1">
                <Share2 className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Shared by teammates</h2>
              </div>
              {displayedSharedAgentList.map((agent) => (
                <SharedAgentCard
                  key={agent.id}
                  agent={agent}
                  connectedIntegrationTypes={connectedIntegrationTypes}
                  isImporting={importingSharedAgentId === agent.id}
                  onImport={handleImportSharedAgent}
                />
              ))}
            </section>
          ) : null}
        </div>

        <div className="border-t border-border/50 p-3">
          <div className="grid grid-cols-4 gap-1">
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/coworkers/overview" title="Overview">
                <Activity className="size-4" />
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/coworkers/history" title="History">
                <History className="size-4" />
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/coworkers/usage" title="Usage">
                <BarChart3 className="size-4" />
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/coworkers/org-chart" title="Org chart">
                <Network className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </aside>

      {selectedAgent ? (
        <div className="min-h-screen min-w-[800px] flex-1 bg-background">
          <CoworkerEditorPage coworkerIdOverride={selectedAgent.id} embedded />
        </div>
      ) : null}
    </div>
  );
}
