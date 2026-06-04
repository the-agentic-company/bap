import {
  Globe,
  FileOutput,
  FileInput,
  Wand2,
  Table,
  Zap,
  Lightbulb,
  ExternalLink,
} from "lucide-react";
import { AppImage } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import type { CommunitySkillContent, UseCase } from "@/lib/community-skills";

// ─── Icon helper ──────────────────────────────────────────────────────────────

function SkillIcon({ name, className }: { name: string; className?: string }) {
  const props = { className };
  switch (name) {
    case "globe":
      return <Globe {...props} />;
    case "file-input":
      return <FileInput {...props} />;
    case "file-output":
      return <FileOutput {...props} />;
    case "table":
      return <Table {...props} />;
    case "wand":
      return <Wand2 {...props} />;
    default:
      return <Zap {...props} />;
  }
}

function renderExampleCaseCard(uc: UseCase) {
  return (
    <div key={uc.title} className="border-border/40 bg-card rounded-xl border p-5 shadow-sm">
      <div className="bg-muted mb-3 inline-flex size-8 items-center justify-center rounded-lg">
        <Lightbulb className="text-muted-foreground size-4" />
      </div>
      <p className="text-sm leading-snug font-medium">{uc.title}</p>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{uc.body}</p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunitySkillDetailContent({
  skill,
  enabled,
  onToggle,
}: {
  skill: CommunitySkillContent;
  enabled?: boolean;
  onToggle?: (value: boolean) => void;
}) {
  const exampleCaseCards = Array.from(skill["useCases"], renderExampleCaseCard);

  return (
    <div className="mx-auto max-w-3xl pb-8">
      {/* ── Hero section ── */}
      <div className="grid grid-cols-1 gap-12 pb-16 md:grid-cols-[1fr_1.3fr] md:gap-16">
        {/* Intro */}
        <div className="flex flex-col">
          {/* Skill icon */}
          <div
            className={
              skill.logoUrl
                ? "mb-5 inline-flex size-14 items-center justify-center rounded-xl border bg-white p-2 shadow-sm dark:bg-gray-800"
                : "bg-muted mb-5 inline-flex size-14 items-center justify-center rounded-xl"
            }
          >
            {skill.logoUrl ? (
              <AppImage
                src={skill.logoUrl}
                alt={skill.title}
                width={28}
                height={28}
                className="h-auto max-h-7 w-auto max-w-7 object-contain"
              />
            ) : (
              <SkillIcon name={skill.iconName} className="size-6" />
            )}
          </div>

          <h1 className="text-foreground text-xl font-semibold tracking-tight md:text-2xl md:leading-snug">
            {skill.title}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-[38ch] text-sm leading-relaxed">
            {skill.description}
          </p>

          <div className="mt-8 flex items-center gap-3">
            {onToggle ? (
              <label className="flex cursor-pointer items-center gap-2">
                <Switch checked={enabled ?? false} onCheckedChange={onToggle} />
                <span className="text-muted-foreground text-sm">
                  {enabled ? "Enabled" : "Disabled"}
                </span>
              </label>
            ) : (
              <Button className="gap-1.5 rounded-lg px-5">
                <Zap className="size-3.5" />
                Activate skill
              </Button>
            )}
            <Button variant="outline" className="gap-1.5 rounded-lg px-5" asChild>
              <a href={skill.githubUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                View source
              </a>
            </Button>
          </div>

          {/* Metadata */}
          <div className="mt-12 space-y-6">
            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Category
              </p>
              <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                {skill.category}
              </span>
            </div>

            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Capabilities
              </p>
              <p className="text-sm">
                {skill.summaryBlocks.length} capabilities · {skill.howItWorks.length} steps
              </p>
            </div>

            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Type
              </p>
              <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                {skill.kind === "tool-integration" ? "Tool integration" : "Community skill"}
              </span>
            </div>
          </div>
        </div>

        {/* What this skill does */}
        <div>
          <section>
            <div className="mb-5">
              <h2 className="text-sm font-semibold">What this skill does</h2>
              <p className="text-muted-foreground mt-1 text-xs">Core capabilities</p>
            </div>

            <div className="grid grid-cols-1 gap-3.5">
              {skill.summaryBlocks.map((block) => (
                <div
                  key={block.title}
                  className="border-border/40 bg-card flex flex-col gap-3.5 rounded-xl border p-5 shadow-sm"
                >
                  <div>
                    <p className="text-sm leading-snug font-medium">{block.title}</p>
                    <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                      {block.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* ── Below hero: single-column content ── */}
      <div className="space-y-14">
        {/* ── How it works ── */}
        <section>
          <div className="mb-5">
            <h2 className="text-sm font-semibold">How it works</h2>
            <p className="text-muted-foreground mt-1 text-xs">Step-by-step execution flow</p>
          </div>
          <div className="border-border/40 bg-card rounded-xl border p-6 shadow-sm">
            <ol className="space-y-3 pl-5 text-sm leading-relaxed">
              {skill.howItWorks.map((step) => (
                <li key={step} className="list-decimal pl-1">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Example use cases ── */}
        <section>
          <div className="mb-5">
            <h2 className="text-sm font-semibold">Example use cases</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Common scenarios where this skill shines
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">{exampleCaseCards}</div>
        </section>

        {/* ── Toggle CTA ── */}
        {onToggle && (
          <section className="flex justify-center pt-2 pb-4">
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={enabled ?? false} onCheckedChange={onToggle} />
              <span className="text-muted-foreground text-sm">
                {enabled ? "Enabled" : "Disabled"}
              </span>
            </label>
          </section>
        )}
      </div>
    </div>
  );
}
