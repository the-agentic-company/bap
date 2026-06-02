import { accessoriesSvg, bodySvg, facesSvg, holesSvg, textureSvg } from "./svg/sources";

export type BrickAvatarOptions = {
  seed: string;
  body: string;
  brickColor: string;
  holes: string;
  face: string;
  texture: string;
  accessory: string;
};

type AvatarOption = {
  value: string;
  label: string;
};

type AvatarColorOption = AvatarOption & {
  color: string;
};

export const BRICK_BODY_OPTIONS = [
  { value: "classic", label: "Classic" },
  { value: "wide", label: "Wide" },
  { value: "tall", label: "Tall" },
  { value: "rounded", label: "Rounded" },
] satisfies AvatarOption[];

export const BRICK_COLOR_OPTIONS = [
  { value: "claw-red", label: "Claw Red", color: "#f05a3c" },
  { value: "signal-yellow", label: "Signal Yellow", color: "#f5b642" },
  { value: "mint", label: "Mint", color: "#4fc39a" },
  { value: "sky", label: "Sky", color: "#4d9be6" },
  { value: "orchid", label: "Orchid", color: "#a77cf2" },
  { value: "graphite", label: "Graphite", color: "#54606f" },
] satisfies AvatarColorOption[];

export const BRICK_HOLE_OPTIONS = [
  { value: "classic", label: "Classic" },
  { value: "offset", label: "Offset" },
  { value: "stacked", label: "Stacked" },
  { value: "single", label: "Single" },
  { value: "none", label: "None" },
] satisfies AvatarOption[];

export const BRICK_FACE_OPTIONS = [
  { value: "happy", label: "Happy" },
  { value: "calm", label: "Calm" },
  { value: "focused", label: "Focused" },
  { value: "sleepy", label: "Sleepy" },
  { value: "robot", label: "Robot" },
] satisfies AvatarOption[];

export const BRICK_TEXTURE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "weathered", label: "Weathered" },
  { value: "rough", label: "Rough" },
] satisfies AvatarOption[];

export const BRICK_ACCESSORY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "glasses", label: "Glasses" },
  { value: "headset", label: "Headset" },
  { value: "hard-hat", label: "Hard Hat" },
  { value: "wizard-hat", label: "Wizard Hat" },
  { value: "bow-tie", label: "Bow Tie" },
  { value: "laptop-badge", label: "Laptop Badge" },
  { value: "tool-belt", label: "Tool Belt" },
] satisfies AvatarOption[];

const VIEWBOX_SIZE = 256;
const STROKE = "#27303a";
const HIGHLIGHT = "#fff8ef";

function optionValues(options: readonly AvatarOption[]) {
  return options.map((option) => option.value);
}

function ensureOption(value: string, options: readonly AvatarOption[]) {
  return optionValues(options).includes(value) ? value : (options[0]?.value ?? "");
}

function getBrickColor(value: string) {
  return (
    BRICK_COLOR_OPTIONS.find((option) => option.value === value)?.color ??
    BRICK_COLOR_OPTIONS[0].color
  );
}

function hashSeed(seed: string) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function pickSeeded(options: readonly AvatarOption[], hash: number, salt: number) {
  return options[(hash + salt * 2654435761) % options.length]?.value ?? "";
}

export function buildSeededBrickAvatarOptions(seed: string): BrickAvatarOptions {
  const hash = hashSeed(seed || "coworker");

  return {
    seed,
    body: pickSeeded(BRICK_BODY_OPTIONS, hash, 1),
    brickColor: pickSeeded(BRICK_COLOR_OPTIONS, hash, 2),
    holes: pickSeeded(BRICK_HOLE_OPTIONS, hash, 3),
    face: pickSeeded(BRICK_FACE_OPTIONS, hash, 4),
    texture: pickSeeded(BRICK_TEXTURE_OPTIONS, hash, 5),
    accessory: pickSeeded(BRICK_ACCESSORY_OPTIONS, hash, 6),
  };
}

function normalizeOptions(options: BrickAvatarOptions): BrickAvatarOptions {
  return {
    seed: options.seed,
    body: ensureOption(options.body, BRICK_BODY_OPTIONS),
    brickColor: ensureOption(options.brickColor, BRICK_COLOR_OPTIONS),
    holes: ensureOption(options.holes, BRICK_HOLE_OPTIONS),
    face: ensureOption(options.face, BRICK_FACE_OPTIONS),
    texture: ensureOption(options.texture, BRICK_TEXTURE_OPTIONS),
    accessory: ensureOption(options.accessory, BRICK_ACCESSORY_OPTIONS),
  };
}

function shadeHex(hex: string, amount: number) {
  const clean = hex.replace("#", "");
  const parts = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) =>
    parseInt(part, 16),
  );
  const next = parts.map((part) => Math.max(0, Math.min(255, Math.round(part + amount))));

  return `#${next.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function extractSvgGroup(source: string, id: string) {
  const groupMatch = source.match(new RegExp(`<g\\s+id="${id}"[^>]*>[\\s\\S]*?<\\/g>`));
  if (groupMatch) {
    return groupMatch[0];
  }

  const emptyGroupMatch = source.match(new RegExp(`<g\\s+id="${id}"[^>]*/>`));
  return emptyGroupMatch?.[0] ?? "";
}

function renderEditableSvgGroup(source: string, id: string, style?: Record<string, string>) {
  const group = extractSvgGroup(source, id);
  if (!group) {
    return "";
  }

  if (!style || Object.keys(style).length === 0) {
    return group;
  }

  const styleAttribute = Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");

  return `<g style="${styleAttribute}">${group}</g>`;
}

function renderBody(kind: string, color: string) {
  const light = shadeHex(color, 34);
  const dark = shadeHex(color, -42);
  return renderEditableSvgGroup(bodySvg, `body-${kind}`, {
    "--brick-front": color,
    "--brick-top": light,
    "--brick-side": dark,
    "--brick-stroke": STROKE,
    "--brick-highlight": HIGHLIGHT,
  });
}

function renderHoles(kind: string) {
  return renderEditableSvgGroup(holesSvg, `holes-${kind}`);
}

function renderFace(kind: string) {
  return renderEditableSvgGroup(facesSvg, `face-${kind}`, {
    "--brick-stroke": STROKE,
  });
}

function renderTexture(kind: string) {
  return renderEditableSvgGroup(textureSvg, `texture-${kind}`);
}

function renderAccessory(kind: string) {
  return renderEditableSvgGroup(accessoriesSvg, `accessory-${kind}`, {
    "--brick-stroke": STROKE,
  });
}

export function renderBrickAvatarSvg(options: BrickAvatarOptions): string {
  const normalized = normalizeOptions(options);
  const color = getBrickColor(normalized.brickColor);
  const body = renderBody(normalized.body, color);
  const holes = renderHoles(normalized.holes);
  const texture = renderTexture(normalized.texture);
  const face = renderFace(normalized.face);
  const accessory = renderAccessory(normalized.accessory);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX_SIZE}" height="${VIEWBOX_SIZE}" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}" role="img" aria-label="Coworker brick avatar"><g>${body}${holes}${texture}${face}${accessory}</g></svg>`;
}

export function BrickAvatarPreview({
  options,
  className,
}: {
  options: BrickAvatarOptions;
  className?: string;
}) {
  const svg = renderBrickAvatarSvg(options);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- generated SVG data URI, no optimization needed
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt="Coworker brick avatar"
      width={VIEWBOX_SIZE}
      height={VIEWBOX_SIZE}
      className={className}
    />
  );
}
