import { useNavigate } from "@tanstack/react-router";
import { Download, ListChecks, Plus, Rocket, Sparkles, Workflow, Wrench, X, Zap } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { getAgentSpec } from "./agent-specs";
import { EditableList, TriggerSelect } from "./editable-list";
import { OutputPreview } from "./output-preview";
import { writeDraftCoworkerPrompt } from "./pending-coworker-prompt";
import { ToolLogo } from "./tool-logo";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Agent detail popup. Expands one agentic app as a bespoke, editable spec: one selected trigger
 * (others stay available), editable actions / outputs / tools, and a framed preview of each
 * page-type output filled with content from the agent's own steps. "Deploy to HeyBap" builds a
 * prompt from the user's current selection and opens the HeyBap coworker builder (`/agents/new`)
 * pre-filled with it.
 */
const M = {
  customizable: { en: "Fully customizable", fr: "Entièrement personnalisable" },
  customizableSub: {
    en: "Edit, add or remove any trigger, action, output or tool. Every agent is tailored to you.",
    fr: "Modifiez, ajoutez ou supprimez chaque déclencheur, action, output ou outil. Chaque agent est sur mesure.",
  },
  triggers: { en: "Triggers", fr: "Déclencheurs" },
  triggerHint: { en: "one active, others available", fr: "un actif, les autres disponibles" },
  addTrigger: { en: "Add a trigger", fr: "Ajouter un déclencheur" },
  triggerPlaceholder: { en: "When should it run?", fr: "Quand doit-il se lancer ?" },
  actions: { en: "What it does", fr: "Ce qu'il fait" },
  addAction: { en: "Add an action", fr: "Ajouter une action" },
  actionPlaceholder: { en: "Describe a step", fr: "Décrivez une étape" },
  outputs: { en: "You get", fr: "Vous obtenez" },
  addOutput: { en: "Add an output", fr: "Ajouter un résultat" },
  outputPlaceholder: { en: "What does it deliver?", fr: "Que produit-il ?" },
  tools: { en: "Connected tools", fr: "Outils connectés" },
  addTool: { en: "Add a tool", fr: "Ajouter un outil" },
  deploy: { en: "Deploy to HeyBap", fr: "Déployer sur HeyBap" },
  close: { en: "Close", fr: "Fermer" },
  badge: { en: "Agentic app", fr: "App agentique" },
  sample: { en: "Sample", fr: "Exemple" },
};

function bullets(arr: string[]): string {
  return arr
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

function buildPrompt(params: {
  locale: string;
  agentName: string;
  verticalName: string;
  trigger: string;
  actions: string[];
  outputs: string[];
  tools: string[];
}): string {
  const { locale, agentName, verticalName, trigger, actions, outputs, tools } = params;
  if (locale === "fr") {
    return `Crée un coworker IA "${agentName}" pour ${verticalName}.

Déclencheur : ${trigger}

Ce qu'il doit faire :
${bullets(actions)}

Ce qu'il doit produire :
${bullets(outputs)}

Outils à connecter : ${tools.join(", ")}

Règle : l'agent propose, un humain relit, modifie et valide chaque action avant tout envoi, avec une piste d'audit complète.`;
  }
  return `Create an AI coworker "${agentName}" for ${verticalName}.

Trigger: ${trigger}

What it should do:
${bullets(actions)}

What it should produce:
${bullets(outputs)}

Tools to connect: ${tools.join(", ")}

Rule: the agent proposes; a human reviews, edits and approves every action before anything is sent, with a full audit trail.`;
}

function ToolChip({ name, onRemove }: { name: string; onRemove: (name: string) => void }) {
  const handleRemove = useCallback(() => onRemove(name), [onRemove, name]);
  return (
    <span className="group/chip inline-flex items-center gap-1.5 rounded-full border border-[#EADFD6] bg-[#FBF5F0] py-1 pr-1.5 pl-2.5 text-xs font-medium text-[#3C1E0A]">
      <ToolLogo name={name} size={15} />
      {name}
      <button
        type="button"
        onClick={handleRemove}
        aria-label={`Remove ${name}`}
        className="flex size-4 items-center justify-center rounded-full text-[#9C8A80] opacity-0 transition group-hover/chip:opacity-100 hover:bg-[#FAE5DF] hover:text-[#D52B0C]"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function ToolChips({
  tools,
  onChange,
  addLabel,
}: {
  tools: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  addLabel: string;
}) {
  const remove = useCallback(
    (name: string) => onChange((prev) => prev.filter((tool) => tool !== name)),
    [onChange],
  );
  const add = useCallback(
    () => onChange((prev) => [...prev, `New tool ${prev.length + 1}`]),
    [onChange],
  );
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      {tools.map((tool) => (
        <ToolChip key={tool} name={tool} onRemove={remove} />
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#E0D2C7] px-3 py-1 font-mono text-[11px] font-medium text-[#9C8A80] transition-colors hover:border-[#D52B0C] hover:text-[#D52B0C]"
      >
        <Plus className="size-3" />
        {addLabel}
      </button>
    </div>
  );
}

export function AgentModal({
  agent,
  vertical,
  index,
  locale,
  onClose,
}: {
  agent: UseCaseAgent;
  vertical: Vertical;
  index: number;
  locale: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    dialog.showModal();
    // Close when the click lands on the dialog element itself (the backdrop), not its content.
    const onBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        onClose();
      }
    };
    dialog.addEventListener("click", onBackdropClick);
    return () => dialog.removeEventListener("click", onBackdropClick);
  }, [onClose]);

  const t = (value: Localized) => loc(locale, value);
  const spec = getAgentSpec(vertical.slug, index);

  const [triggers, setTriggers] = useState<string[]>(() =>
    (spec?.triggers ?? []).map((value) => loc(locale, value)),
  );
  const [selectedTrigger, setSelectedTrigger] = useState(0);
  const [actions, setActions] = useState<string[]>(() =>
    (spec?.actions ?? []).map((value) => loc(locale, value)),
  );
  const [outputs, setOutputs] = useState<string[]>(() =>
    (spec?.outputs ?? []).map((output) => loc(locale, output.label)),
  );
  const [tools, setTools] = useState<string[]>(() =>
    spec?.tools?.length ? spec.tools : vertical.integrations.items,
  );

  // Framed previews for page-type outputs, filled with the agent's own steps as sample content.
  const previews = useMemo(() => {
    const pageOutputs = (spec?.outputs ?? []).filter((output) => output.isPage);
    return pageOutputs.map((output, position) => ({
      key: output.label.en,
      label: loc(locale, output.label),
      lines: actions.slice(position * 2, position * 2 + 4),
    }));
  }, [spec, locale, actions]);

  const handleDeploy = useCallback(() => {
    const prompt = buildPrompt({
      locale,
      agentName: loc(locale, agent.name),
      verticalName: loc(locale, vertical.name),
      trigger: triggers[selectedTrigger] ?? triggers[0] ?? "",
      actions,
      outputs,
      tools,
    });
    // Pre-fill the home composer with the prompt WITHOUT submitting; the user edits and sends it.
    writeDraftCoworkerPrompt(prompt);
    void navigate({ to: "/" });
  }, [navigate, locale, agent, vertical, triggers, selectedTrigger, actions, outputs, tools]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={t(agent.name)}
      className="relative m-auto w-[calc(100%-2.5rem)] max-w-xl rounded-3xl bg-white p-7 text-[#241712] shadow-2xl backdrop:bg-[#241712]/55"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t(M.close)}
        className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-full text-[#9C8A80] transition-colors hover:bg-[#F3E9E1] hover:text-[#241712]"
      >
        <X className="size-4" />
      </button>

      <div className="flex items-center gap-3.5 pr-8">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3E9E1]">
          <Workflow className="size-6 text-[#D52B0C]" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#D52B0C] uppercase">
            {t(M.badge)}
          </p>
          <h3 className="text-xl font-bold tracking-tight text-[#241712]">{t(agent.name)}</h3>
        </div>
      </div>

      <p className="mt-4 leading-relaxed text-[#6E5C53]">{t(agent.description)}</p>

      <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[#F6D6CC] bg-[#FAE5DF] p-3.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-[#D52B0C]" />
        <div>
          <p className="text-sm font-semibold text-[#241712]">{t(M.customizable)}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-[#6E5C53]">{t(M.customizableSub)}</p>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <TriggerSelect
          label={t(M.triggers)}
          icon={Zap}
          hint={t(M.triggerHint)}
          addLabel={t(M.addTrigger)}
          placeholder={t(M.triggerPlaceholder)}
          items={triggers}
          selected={selectedTrigger}
          onSelect={setSelectedTrigger}
          onChange={setTriggers}
        />
        <EditableList
          label={t(M.actions)}
          icon={ListChecks}
          addLabel={t(M.addAction)}
          placeholder={t(M.actionPlaceholder)}
          items={actions}
          onChange={setActions}
        />
        <div>
          <EditableList
            label={t(M.outputs)}
            icon={Download}
            addLabel={t(M.addOutput)}
            placeholder={t(M.outputPlaceholder)}
            items={outputs}
            onChange={setOutputs}
          />
          {previews.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {previews.map((preview) => (
                <OutputPreview
                  key={preview.key}
                  label={preview.label}
                  sampleLabel={t(M.sample)}
                  locale={locale}
                  lines={preview.lines}
                  tools={tools}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-[#9C8A80] uppercase">
            <Wrench className="size-3.5 text-[#D52B0C]" />
            {t(M.tools)}
          </p>
          <ToolChips tools={tools} onChange={setTools} addLabel={t(M.addTool)} />
        </div>
      </div>

      <div className="mt-7">
        <Button
          type="button"
          onClick={handleDeploy}
          className="h-11 w-full bg-[#241712] text-white hover:bg-[#3C1E0A]"
        >
          <Rocket className="mr-1.5 size-4" />
          {t(M.deploy)}
        </Button>
      </div>
    </dialog>
  );
}
