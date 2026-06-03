"use client";

import {
  Wrench,
  Puzzle,
  Check,
  Loader2,
  AlertCircle,
  ArrowRight,
  Terminal,
  FolderSearch,
  FileSearch,
  BookOpen,
  FilePen,
  Pencil,
  Globe,
  StopCircle,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import {
  useCallback,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppImage } from "@/components/chat/app-image";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { getBrandfetchLogoUrl } from "@/lib/brandfetch";
import { type WorkspaceMcpServerLike, getExecutorDisplayMetadata } from "@/lib/executor-tool";
import {
  getIntegrationLogo,
  getIntegrationDisplayName,
  getIntegrationIcon,
  getOperationLabel,
} from "@/lib/integration-icons";
import { parseCliCommand } from "@/lib/parse-cli-command";

// Map internal SDK tool names to user-friendly display names
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Bash: "Running command",
  Glob: "Searching files",
  Grep: "Searching content",
  Read: "Reading file",
  Write: "Writing file",
  Edit: "Editing file",
  WebSearch: "Searching web",
  WebFetch: "Fetching page",
};

// Map internal SDK tool names to icons (all use consistent blue color)
const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: FileSearch,
  Read: BookOpen,
  Write: FilePen,
  Edit: Pencil,
  WebSearch: Globe,
  WebFetch: Globe,
};

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

function getToolIcon(toolName: string): LucideIcon {
  return TOOL_ICONS[toolName] ?? Wrench;
}

export type ActivityItemData = {
  id: string;
  timestamp: number;
  type: "text" | "thinking" | "tool_call" | "tool_result" | "system";
  content: string;
  toolUseId?: string;
  toolName?: string;
  integration?: DisplayIntegrationType;
  operation?: string;
  status?: "running" | "complete" | "error" | "interrupted";
  input?: unknown;
  result?: unknown;
  elapsedMs?: number;
};

type Props = {
  item: ActivityItemData;
  executorSources?: readonly WorkspaceMcpServerLike[];
};

const TOOL_DETAILS_INITIAL = { height: 0, opacity: 0, y: -2 };
const TOOL_DETAILS_ANIMATE = { height: "auto", opacity: 1, y: 0 };
const TOOL_DETAILS_EXIT = { height: 0, opacity: 0, y: -2 };
const TOOL_DETAILS_TRANSITION: Transition = { duration: 0.2, ease: "easeInOut" };
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const ANSI_CSI_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_PATTERN = new RegExp(String.raw`\u001B\][^\u0007]*(?:\u0007|\u001B\\)`, "g");

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_OSC_PATTERN, "").replaceAll(ANSI_CSI_PATTERN, "");
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return stripAnsi(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Extract command string from Bash tool input
function formatInput(input: unknown, toolName?: string): string {
  if (input === undefined || input === null) {
    return "";
  }

  // For Bash commands, extract just the command string
  if (toolName === "Bash" && typeof input === "object" && input !== null) {
    const bashInput = input as { command?: string };
    if (bashInput.command) {
      return bashInput.command;
    }
  }

  return formatValue(input);
}

function getInputDescription(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const withDescription = input as { description?: unknown };
  if (typeof withDescription.description !== "string") {
    return null;
  }
  const trimmedDescription = withDescription.description.trim();
  return trimmedDescription.length > 0 ? trimmedDescription : null;
}

export function ActivityItem({ item, executorSources = [] }: Props) {
  const { type, content, toolName, integration, operation, status, input, result } = item;
  const [showDetails, setShowDetails] = useState(false);
  const parsedCommand = useMemo(() => {
    if (toolName !== "Bash" || typeof input !== "object" || input === null) {
      return null;
    }

    const command = (input as { command?: unknown }).command;
    return typeof command === "string" ? parseCliCommand(command) : null;
  }, [input, toolName]);
  const executorDisplay = useMemo(
    () => getExecutorDisplayMetadata(input, executorSources, toolName),
    [executorSources, input, toolName],
  );
  const displayIntegration = (parsedCommand?.integration ?? integration) as
    | DisplayIntegrationType
    | "coworker"
    | undefined;
  const resolvedIntegration = displayIntegration ?? executorDisplay.integration;
  const displayOperation = parsedCommand?.operation ?? operation;
  const handleToggleDetails = useCallback(() => {
    setShowDetails((prev) => !prev);
  }, []);
  const markdownComponents = useMemo(
    () => ({
      table: ({ children }: { children?: ReactNode }) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-xs">{children}</table>
        </div>
      ),
      thead: ({ children }: { children?: ReactNode }) => (
        <thead className="border-border border-b">{children}</thead>
      ),
      tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
      tr: ({ children }: { children?: ReactNode }) => (
        <tr className="border-border border-b last:border-b-0">{children}</tr>
      ),
      th: ({ children }: { children?: ReactNode }) => (
        <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">{children}</th>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td className="px-2 py-1 align-top whitespace-nowrap">{children}</td>
      ),
      a: ({ children, ...props }: ComponentPropsWithoutRef<"a">) => (
        <a {...props} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    }),
    [],
  );

  // Get icon for tool calls only
  const getIcon = () => {
    if (type !== "tool_call" && type !== "tool_result") {
      return null;
    }

    if (executorDisplay.source) {
      const logoUrl = executorDisplay.source.endpoint
        ? getBrandfetchLogoUrl(executorDisplay.source.endpoint)
        : null;
      if (logoUrl) {
        return (
          <AppImage
            src={logoUrl}
            alt={executorDisplay.source.name?.trim() || executorDisplay.source.namespace}
            width={14}
            height={14}
            className="h-3.5 w-auto flex-shrink-0 rounded-sm"
          />
        );
      }

      return <Puzzle className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />;
    }

    // Integration icons take priority when there is no matched source row.
    if (resolvedIntegration) {
      const logo = getIntegrationLogo(resolvedIntegration);
      if (logo) {
        return (
          <AppImage
            src={logo}
            alt={getIntegrationDisplayName(resolvedIntegration)}
            width={14}
            height={14}
            className="h-3.5 w-auto flex-shrink-0"
          />
        );
      }

      const IntegrationIcon = getIntegrationIcon(resolvedIntegration);
      if (IntegrationIcon) {
        return <IntegrationIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />;
      }
    }

    // Tool-specific icons
    if (toolName) {
      const ToolIcon = getToolIcon(toolName);
      return <ToolIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />;
    }

    return <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />;
  };

  const getStatusIcon = () => {
    if (type === "thinking") {
      return null;
    }

    switch (status) {
      case "running":
        return <Loader2 className="text-muted-foreground h-3 w-3 flex-shrink-0 animate-spin" />;
      case "complete":
        return <Check className="h-3 w-3 flex-shrink-0 text-green-500" />;
      case "error":
        return <AlertCircle className="h-3 w-3 flex-shrink-0 text-red-500" />;
      case "interrupted":
        return <StopCircle className="h-3 w-3 flex-shrink-0 text-orange-500" />;
      default:
        return null;
    }
  };

  // Render text content (agent response)
  if (type === "text") {
    return (
      <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 text-foreground max-w-none py-0.5 text-xs">
        <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // Render thinking content
  if (type === "thinking") {
    return (
      <div className="text-muted-foreground py-0.5 text-xs whitespace-pre-wrap italic">
        {content}
      </div>
    );
  }

  // Render system message (interruption, etc.)
  if (type === "system") {
    const isWarning = content.toLowerCase().includes("warning");
    const SystemIcon = isWarning ? AlertCircle : StopCircle;
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-xs text-orange-600 dark:text-orange-400">
        <SystemIcon className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-medium">{content}</span>
      </div>
    );
  }

  // Render tool call with full input/result
  // For integrations, show operation label (e.g., "Listing channels")
  // For regular tools, show tool action (e.g., "Running command")
  const displayName = (() => {
    const inputDescription = getInputDescription(input);
    if (inputDescription) {
      return inputDescription;
    }

    if (executorDisplay.displayName) {
      return executorDisplay.displayName;
    }

    if (resolvedIntegration) {
      const op = displayOperation || toolName;
      return op
        ? getOperationLabel(resolvedIntegration, op)
        : getIntegrationDisplayName(resolvedIntegration);
    }
    return toolName ? getToolDisplayName(toolName) : content;
  })();

  const formattedInput = formatInput(executorDisplay.metadataInput, toolName);
  const formattedResult = formatValue(result);
  const hasDetails = Boolean(formattedInput || formattedResult);
  const requestLabel = toolName ? `Request (${toolName})` : "Request";

  return (
    <div className="py-0.5 text-xs">
      {hasDetails ? (
        <button
          type="button"
          onClick={handleToggleDetails}
          className="hover:bg-muted/30 -ml-0.5 flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-left"
          aria-label={showDetails ? "Hide tool details" : "Show tool details"}
        >
          {getIcon()}
          <span className="text-foreground font-mono">{displayName}</span>
          <span className="inline-flex items-center">
            <ArrowRight
              className={`text-muted-foreground h-3 w-3 flex-shrink-0 transition-transform duration-200 ${showDetails ? "rotate-90" : ""}`}
            />
          </span>
          <div className="flex-1" />
          {getStatusIcon()}
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          {getIcon()}
          <span className="text-foreground font-mono">{displayName}</span>
          <div className="flex-1" />
          {getStatusIcon()}
        </div>
      )}
      <AnimatePresence initial={false}>
        {showDetails && (
          <motion.div
            initial={TOOL_DETAILS_INITIAL}
            animate={TOOL_DETAILS_ANIMATE}
            exit={TOOL_DETAILS_EXIT}
            transition={TOOL_DETAILS_TRANSITION}
            className="mt-1 ml-5 overflow-hidden"
          >
            <div className="border-border/60 space-y-2 border-l pl-3">
              {formattedInput && (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    {requestLabel}
                  </p>
                  <pre className="bg-muted/40 text-muted-foreground overflow-x-auto rounded-sm px-2 py-1 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {formattedInput}
                  </pre>
                </div>
              )}
              {formattedResult && (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    Response
                  </p>
                  <pre className="bg-muted/40 text-muted-foreground overflow-x-auto rounded-sm px-2 py-1 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {formattedResult}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
