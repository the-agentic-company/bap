import { parseModelReference } from "@cmdclaw/core/lib/model-reference";
import {
  getEmptyProviderAuthAvailability,
  type ProviderAuthSource,
} from "@cmdclaw/core/lib/provider-auth-source";
import { T } from "gt-react";
import { Check, ChevronDown, Lock } from "lucide-react";
import { useCallback } from "react";
import type { ProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsAdmin } from "@/hooks/use-is-admin";

type ModelOption = {
  authSource: ProviderAuthSource | null;
  adminOnly?: boolean;
  id: string;
  name: string;
};

type SortToken = { type: "text"; value: string } | { type: "number"; value: number };

function tokenizeModelName(name: string): SortToken[] {
  return name
    .split(/(\d+(?:\.\d+)?)/)
    .filter((token) => token.length > 0)
    .map((token) =>
      /^\d+(?:\.\d+)?$/.test(token)
        ? { type: "number", value: Number(token) }
        : { type: "text", value: token.toLowerCase() },
    );
}

function compareModelNames(a: string, b: string): number {
  const aTokens = tokenizeModelName(a);
  const bTokens = tokenizeModelName(b);
  const maxLength = Math.max(aTokens.length, bTokens.length);

  for (let index = 0; index < maxLength; index += 1) {
    const aToken = aTokens[index];
    const bToken = bTokens[index];

    if (!aToken || !bToken) {
      break;
    }

    if (aToken.type === "number" && bToken.type === "number" && aToken.value !== bToken.value) {
      return bToken.value - aToken.value;
    }

    if (aToken.type === "text" && bToken.type === "text" && aToken.value !== bToken.value) {
      return aToken.value.localeCompare(bToken.value);
    }

    if (aToken.type !== bToken.type) {
      return aToken.type === "text" ? -1 : 1;
    }
  }

  if (aTokens.length !== bTokens.length) {
    return aTokens.length - bTokens.length;
  }

  return a.localeCompare(b);
}

function sortModels<T extends ModelOption>(models: T[]): T[] {
  return models.toSorted((a, b) => compareModelNames(a.name, b.name));
}

const CMDCLAW_MODELS: ModelOption[] = [
  {
    authSource: "shared",
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
  },
  {
    authSource: "shared",
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
  },
  {
    authSource: "shared",
    id: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
  },
  {
    authSource: "shared",
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
  },
  {
    adminOnly: true,
    authSource: "shared",
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
  },
];

const PERSONAL_CHATGPT_MODELS: ModelOption[] = [
  {
    authSource: "user",
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
  },
  {
    authSource: "user",
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
  },
  {
    authSource: "user",
    id: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
  },
];

const USER_VISIBLE_CMDCLAW_MODELS = CMDCLAW_MODELS.filter((model) => !model.adminOnly);
const SORTED_PERSONAL_CHATGPT_MODELS = sortModels(PERSONAL_CHATGPT_MODELS);

type Props = {
  selectedModel: string;
  selectedAuthSource: ProviderAuthSource | null;
  providerAvailability: ProviderAuthAvailabilityByProvider;
  onSelectionChange: (input: { model: string; authSource?: ProviderAuthSource | null }) => void;
  disabled?: boolean;
};

type ModelSectionProps = {
  models: ModelOption[];
  selectedModel: string;
  selectedAuthSource: ProviderAuthSource | null;
  providerAvailability: ProviderAuthAvailabilityByProvider;
  onSelectionChange: (input: { model: string; authSource?: ProviderAuthSource | null }) => void;
};

function ModelSection({
  models,
  selectedModel,
  selectedAuthSource,
  providerAvailability,
  onSelectionChange,
}: ModelSectionProps) {
  const handleModelSelect = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const modelId = event.currentTarget.dataset.modelId;
      const authSourceValue = event.currentTarget.dataset.authSource;
      if (!modelId) {
        return;
      }

      onSelectionChange({
        model: modelId,
        authSource:
          authSourceValue === "shared" ? "shared" : authSourceValue === "user" ? "user" : null,
      });
    },
    [onSelectionChange],
  );

  return models.map((model) => {
    const { providerID } = parseModelReference(model.id);
    const availability = providerAvailability[providerID] ?? getEmptyProviderAuthAvailability();
    const isLocked = model.authSource ? !availability[model.authSource] : false;
    const isSelected =
      selectedModel === model.id &&
      (model.authSource === null
        ? selectedAuthSource === null
        : selectedAuthSource === model.authSource);

    return (
      <DropdownMenuItem
        key={`${model.authSource ?? "none"}-${model.id}`}
        data-testid={`chat-model-option-${model.authSource === "user" ? "user" : "cmdclaw"}-${model.id}`}
        data-model-id={model.id}
        data-auth-source={model.authSource ?? ""}
        disabled={isLocked}
        onClick={handleModelSelect}
      >
        <span className="flex-1">{model.name}</span>
        {isLocked ? <Lock className="text-muted-foreground h-3.5 w-3.5" /> : null}
        {isSelected ? <Check className="text-foreground h-3.5 w-3.5" /> : null}
      </DropdownMenuItem>
    );
  });
}

export function ModelSelector({
  selectedModel,
  selectedAuthSource,
  providerAvailability,
  onSelectionChange,
  disabled,
}: Props) {
  const { isAdmin } = useIsAdmin();
  const visibleCmdClawModels = isAdmin ? CMDCLAW_MODELS : USER_VISIBLE_CMDCLAW_MODELS;
  const allModels = [...CMDCLAW_MODELS, ...PERSONAL_CHATGPT_MODELS];
  const currentModel =
    allModels.find(
      (model) => model.id === selectedModel && model.authSource === selectedAuthSource,
    ) ?? allModels.find((model) => model.id === selectedModel);
  const displayName = currentModel?.name ?? selectedModel;
  const openSubscriptions = useCallback(() => {
    window.location.href = "/settings/subscriptions";
  }, []);
  const openAIAvailability = providerAvailability.openai ?? getEmptyProviderAuthAvailability();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-testid="chat-model-selector"
          className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
        >
          {displayName}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>
          <T>CmdClaw Models</T>
        </DropdownMenuLabel>
        <ModelSection
          models={visibleCmdClawModels}
          selectedModel={selectedModel}
          selectedAuthSource={selectedAuthSource}
          providerAvailability={providerAvailability}
          onSelectionChange={onSelectionChange}
        />

        <DropdownMenuSeparator />

        {openAIAvailability.user ? (
          <>
            <DropdownMenuLabel>
              <T>Your ChatGPT</T>
            </DropdownMenuLabel>
            <ModelSection
              models={SORTED_PERSONAL_CHATGPT_MODELS}
              selectedModel={selectedModel}
              selectedAuthSource={selectedAuthSource}
              providerAvailability={providerAvailability}
              onSelectionChange={onSelectionChange}
            />
          </>
        ) : (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <T>Your ChatGPT</T>
              <Lock className="text-muted-foreground h-3 w-3" />
            </DropdownMenuLabel>
            <DropdownMenuItem
              className="text-muted-foreground text-xs"
              onClick={openSubscriptions}
              data-testid="chat-model-open-subscriptions"
            >
              <T>Connect in Settings to unlock</T>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
