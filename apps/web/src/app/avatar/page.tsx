"use client";

import { Copy, Download, Dices, FileImage, FileText, RotateCcw, Shuffle } from "lucide-react";
import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  BRICK_ACCESSORY_OPTIONS,
  BRICK_BODY_OPTIONS,
  BRICK_COLOR_OPTIONS,
  BRICK_FACE_OPTIONS,
  BRICK_HOLE_OPTIONS,
  BRICK_TEXTURE_OPTIONS,
  BrickAvatarPreview,
  buildSeededBrickAvatarOptions,
  renderBrickAvatarSvg,
  type BrickAvatarOptions,
} from "@/components/avatar/brick-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type AvatarField = keyof Omit<BrickAvatarOptions, "seed">;

type Option = {
  value: string;
  label: string;
  color?: string;
};

const CONTROL_GROUPS: {
  title: string;
  fields: { field: AvatarField; label: string; options: Option[] }[];
}[] = [
  {
    title: "Brick",
    fields: [
      { field: "body", label: "Body", options: BRICK_BODY_OPTIONS },
      { field: "brickColor", label: "Color", options: BRICK_COLOR_OPTIONS },
      { field: "holes", label: "Holes", options: BRICK_HOLE_OPTIONS },
      { field: "texture", label: "Texture", options: BRICK_TEXTURE_OPTIONS },
    ],
  },
  {
    title: "Character",
    fields: [
      { field: "face", label: "Face", options: BRICK_FACE_OPTIONS },
      { field: "accessory", label: "Accessory", options: BRICK_ACCESSORY_OPTIONS },
    ],
  },
];

function randomSeed() {
  const left = ["ledger", "signal", "mason", "orbit", "relay", "tempo", "atlas", "rivet"];
  const right = ["runner", "scribe", "pilot", "broker", "maker", "keeper", "clerk", "forge"];
  const index = Math.floor(Math.random() * left.length * right.length);
  return `${left[index % left.length]}-${right[Math.floor(index / left.length)]}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getFileStem(seed: string) {
  return `coworker-avatar-${
    seed
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") || "brick"
  }`;
}

function svgToJpegBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const handleLoad = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas is not available"));
        return;
      }

      context.fillStyle = "oklch(0.985 0.006 35)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Could not export JPG"));
          }
        },
        "image/jpeg",
        0.94,
      );
    };

    const handleError = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load SVG"));
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    image.src = url;
  });
}

function Swatch({ option }: { option: Option }) {
  if (!option.color) {
    return null;
  }

  return (
    <svg
      className="size-3 rounded-sm border border-foreground/10"
      aria-hidden="true"
      viewBox="0 0 12 12"
    >
      <rect width="12" height="12" rx="2" fill={option.color} />
    </svg>
  );
}

function SeedInput({ value, onUpdate }: { value: string; onUpdate: (nextSeed: string) => void }) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onUpdate(event.target.value);
    },
    [onUpdate],
  );

  return (
    <Input value={value} onChange={handleChange} placeholder="agent-name" className="font-mono" />
  );
}

function AvatarOptionTile({
  field,
  option,
  selected,
  currentOptions,
  onUpdate,
}: {
  field: AvatarField;
  option: Option;
  selected: boolean;
  currentOptions: BrickAvatarOptions;
  onUpdate: (field: AvatarField, value: string) => void;
}) {
  const previewOptions = useMemo(
    () => ({ ...currentOptions, [field]: option.value }),
    [currentOptions, field, option.value],
  );
  const handleClick = useCallback(() => {
    onUpdate(field, option.value);
  }, [field, onUpdate, option.value]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={selected}
      className={
        selected
          ? "group grid min-w-0 gap-2 rounded-lg border border-[oklch(0.43_0.12_35)] bg-[oklch(0.94_0.025_35)] p-2 text-left shadow-sm transition-colors"
          : "group grid min-w-0 gap-2 rounded-lg border border-[oklch(0.82_0.018_45)] bg-[oklch(0.985_0.006_35)] p-2 text-left transition-colors hover:border-[oklch(0.58_0.06_38)] hover:bg-[oklch(0.965_0.012_35)]"
      }
    >
      <span className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-[oklch(0.965_0.012_35)]">
        <BrickAvatarPreview options={previewOptions} className="size-full" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[oklch(0.24_0.018_35)]">
        <Swatch option={option} />
        <span className="truncate">{option.label}</span>
      </span>
    </button>
  );
}

function AttributeGallery({
  field,
  label,
  options,
  value,
  currentOptions,
  onUpdate,
}: {
  field: AvatarField;
  label: string;
  options: Option[];
  value: string;
  currentOptions: BrickAvatarOptions;
  onUpdate: (field: AvatarField, value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-[oklch(0.28_0.018_35)]">{label}</h3>
        <span className="font-mono text-[10px] text-[oklch(0.48_0.02_35)]">{value}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <AvatarOptionTile
            key={option.value}
            field={field}
            option={option}
            selected={option.value === value}
            currentOptions={currentOptions}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}

export default function AvatarPage() {
  const [seed, setSeed] = useState("ops-brick");
  const [options, setOptions] = useState<BrickAvatarOptions>(() =>
    buildSeededBrickAvatarOptions("ops-brick"),
  );

  const svg = useMemo(() => renderBrickAvatarSvg(options), [options]);

  const updateSeed = useCallback((nextSeed: string) => {
    setSeed(nextSeed);
    setOptions(buildSeededBrickAvatarOptions(nextSeed));
  }, []);

  const updateField = useCallback((field: AvatarField, value: string) => {
    setOptions((current) => ({ ...current, [field]: value }));
  }, []);

  const resetFromSeed = useCallback(() => {
    setOptions(buildSeededBrickAvatarOptions(seed));
    toast.success("Avatar reset from seed");
  }, [seed]);

  const shuffleSeed = useCallback(() => {
    updateSeed(randomSeed());
  }, [updateSeed]);

  const downloadSvg = useCallback(() => {
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `${getFileStem(seed)}.svg`,
    );
  }, [seed, svg]);

  const downloadJpg = useCallback(async () => {
    try {
      const blob = await svgToJpegBlob(svg);
      downloadBlob(blob, `${getFileStem(seed)}.jpg`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export JPG");
    }
  }, [seed, svg]);

  const copySvg = useCallback(async () => {
    await navigator.clipboard.writeText(svg);
    toast.success("SVG copied");
  }, [svg]);

  return (
    <main className="min-h-screen bg-[oklch(0.985_0.006_35)]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
        <header className="flex flex-col gap-4 border-b border-[oklch(0.78_0.025_45)] pb-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.74_0.04_42)] bg-[oklch(0.94_0.025_35)] px-2.5 py-1 text-xs font-medium text-[oklch(0.34_0.06_35)]">
              <Dices className="size-3.5" />
              Coworker Avatar Playground
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl leading-tight font-semibold tracking-normal text-[oklch(0.19_0.018_35)]">
                Build a brick with a job to do.
              </h1>
              <p className="max-w-[68ch] text-sm leading-6 text-[oklch(0.42_0.025_35)]">
                Generate a stable brick avatar from a seed, tune the costume, then download it as
                SVG or JPG.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={resetFromSeed}
                  aria-label="Reset from seed"
                >
                  <RotateCcw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset from seed</TooltipContent>
            </Tooltip>
            <Button variant="outline" onClick={copySvg}>
              <Copy className="size-4" />
              Copy SVG
            </Button>
            <Button variant="outline" onClick={downloadSvg}>
              <FileText className="size-4" />
              SVG
            </Button>
            <Button
              className="bg-[oklch(0.43_0.12_35)] text-[oklch(0.985_0.006_35)] hover:bg-[oklch(0.36_0.11_35)]"
              onClick={downloadJpg}
            >
              <FileImage className="size-4" />
              JPG
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(360px,1fr)_420px]">
          <section className="relative overflow-hidden rounded-xl border border-[oklch(0.78_0.025_45)] bg-[oklch(0.965_0.012_35)]">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,oklch(0.75_0.018_42)_1px,transparent_1px),linear-gradient(0deg,oklch(0.75_0.018_42)_1px,transparent_1px)] bg-[size:42px_42px] opacity-25" />
            <div className="relative flex min-h-[540px] items-center justify-center p-5 md:min-h-[680px] md:p-10">
              <div className="w-full max-w-[560px]">
                <BrickAvatarPreview
                  options={options}
                  className="w-full drop-shadow-[0_28px_55px_oklch(0.28_0.05_35_/_0.2)]"
                />
              </div>
            </div>
            <div className="absolute right-4 bottom-4 left-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[oklch(0.78_0.025_45)] bg-[oklch(0.99_0.004_35)]/95 px-3 py-2 text-xs text-[oklch(0.42_0.025_35)]">
              <span className="font-mono">{seed || "empty-seed"}</span>
              <span>{options.accessory === "none" ? "no accessory" : options.accessory}</span>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-xl border border-[oklch(0.78_0.025_45)] bg-[oklch(0.995_0.003_35)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[oklch(0.19_0.018_35)]">Seed</h2>
                  <p className="text-xs text-[oklch(0.48_0.02_35)]">
                    Stable defaults for each Coworker.
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={shuffleSeed}
                      aria-label="Shuffle seed"
                    >
                      <Shuffle className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Shuffle seed</TooltipContent>
                </Tooltip>
              </div>
              <SeedInput value={seed} onUpdate={updateSeed} />
            </section>

            {CONTROL_GROUPS.map((group) => (
              <section
                key={group.title}
                className="rounded-xl border border-[oklch(0.78_0.025_45)] bg-[oklch(0.995_0.003_35)] p-4"
              >
                <h2 className="mb-4 text-sm font-semibold text-[oklch(0.19_0.018_35)]">
                  {group.title}
                </h2>
                <div className="space-y-4">
                  {group.fields.map((control) => (
                    <AttributeGallery
                      key={control.field}
                      field={control.field}
                      label={control.label}
                      options={control.options}
                      value={String(options[control.field])}
                      currentOptions={options}
                      onUpdate={updateField}
                    />
                  ))}
                </div>
              </section>
            ))}

            <section className="rounded-xl border border-[oklch(0.78_0.025_45)] bg-[oklch(0.94_0.025_35)] p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.43_0.12_35)] text-[oklch(0.985_0.006_35)]">
                  <Download className="size-4" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-[oklch(0.19_0.018_35)]">
                    Export-ready
                  </h2>
                  <p className="text-xs leading-5 text-[oklch(0.42_0.025_35)]">
                    SVG keeps the brick editable. JPG gives you a flat image for tools that do not
                    accept vector files.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
