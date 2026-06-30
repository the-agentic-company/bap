import { Link } from "@tanstack/react-router";
import { Download, ListChecks, Plus, Sparkles, Workflow, Wrench, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getAgentSpec } from "./agent-specs";
import { EditableList } from "./editable-list";
import { ToolLogo } from "./tool-logo";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Agent detail popup. Expands one agentic app and makes its bespoke nature obvious: every part
 * (triggers, actions, outputs, tools) is presented as customizable (edit / add / remove). Outputs
 * that are pages get a small framed preview. Footer deploys to HeyBap.
 *
 * Native <dialog> (showModal) so Escape, focus trap and backdrop are handled by the platform.
 */
const M = {
  customizable: { en: "Fully customizable", fr: "Entièrement personnalisable" },
  customizableSub: {
    en: "Edit, add or remove any trigger, action, output or tool. Every agent is tailored to you.",
    fr: "Modifiez, ajoutez ou supprimez chaque trigger, action, output ou outil. Chaque agent est sur mesure.",
  },
  triggers: { en: "Triggers", fr: "Déclencheurs" },
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
  preview: { en: "Preview", fr: "Aperçu" },
  deploy: { en: "Deploy to HeyBap", fr: "Déployer sur HeyBap" },
  close: { en: "Close", fr: "Fermer" },
  badge: { en: "Agentic app", fr: "App agentique" },
};

function PagePreview({ label }: { label: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-[#E0D2C7] bg-white">
      <div className="flex items-center gap-1.5 border-b border-[#EADFD6] bg-[#F3E9E1] px-3 py-2">
        <span className="size-2 rounded-full bg-[#FF5F57]" />
        <span className="size-2 rounded-full bg-[#FEBC2E]" />
        <span className="size-2 rounded-full bg-[#28C840]" />
        <span className="ml-1 truncate font-mono text-[10px] text-[#9C8A80]">{label}</span>
      </div>
      <div className="space-y-1.5 p-3">
        <div className="h-2 w-2/5 rounded-full bg-[#D52B0C]/70" />
        <div className="h-1.5 w-full rounded-full bg-[#EADFD6]" />
        <div className="h-1.5 w-11/12 rounded-full bg-[#EADFD6]" />
        <div className="h-1.5 w-3/4 rounded-full bg-[#EADFD6]" />
        <div className="mt-2 h-6 w-24 rounded-md bg-[#F3E9E1]" />
      </div>
    </figure>
  );
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

function ToolChips({ initial, addLabel }: { initial: string[]; addLabel: string }) {
  const counterRef = useRef(0);
  const [tools, setTools] = useState(initial);
  const remove = useCallback((name: string) => {
    setTools((prev) => prev.filter((tool) => tool !== name));
  }, []);
  const add = useCallback(() => {
    counterRef.current += 1;
    setTools((prev) => [...prev, `New tool ${counterRef.current}`]);
  }, []);
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const t = (value: Localized) => loc(locale, value);
  const spec = getAgentSpec(vertical.slug, index);
  const outputs = spec?.outputs ?? [];
  const triggers = useMemo(() => (spec?.triggers ?? []).map((v) => loc(locale, v)), [spec, locale]);
  const actions = useMemo(() => (spec?.actions ?? []).map((v) => loc(locale, v)), [spec, locale]);
  const outputLabels = useMemo(
    () => (spec?.outputs ?? []).map((output) => loc(locale, output.label)),
    [spec, locale],
  );
  const tools = useMemo(
    () => (spec?.tools?.length ? spec.tools : vertical.integrations.items),
    [spec, vertical],
  );
  const pageOutputs = outputs.filter((output) => output.isPage);

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
        <EditableList
          label={t(M.triggers)}
          icon={Zap}
          addLabel={t(M.addTrigger)}
          placeholder={t(M.triggerPlaceholder)}
          items={triggers}
        />
        <EditableList
          label={t(M.actions)}
          icon={ListChecks}
          addLabel={t(M.addAction)}
          placeholder={t(M.actionPlaceholder)}
          items={actions}
        />
        <div>
          <EditableList
            label={t(M.outputs)}
            icon={Download}
            addLabel={t(M.addOutput)}
            placeholder={t(M.outputPlaceholder)}
            items={outputLabels}
          />
          {pageOutputs.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {pageOutputs.map((output) => (
                <PagePreview key={output.label.en} label={t(output.label)} />
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-[#9C8A80] uppercase">
            <span className="text-[#D52B0C]">
              <Wrench className="size-3.5" />
            </span>
            {t(M.tools)}
          </p>
          <ToolChips initial={tools} addLabel={t(M.addTool)} />
        </div>
      </div>

      <div className="mt-7">
        <Button asChild className="h-11 w-full bg-[#241712] text-white hover:bg-[#3C1E0A]">
          <Link to="/login">
            <Download className="mr-1.5 size-4" />
            {t(M.deploy)}
          </Link>
        </Button>
      </div>
    </dialog>
  );
}
