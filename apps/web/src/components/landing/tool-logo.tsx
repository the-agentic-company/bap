import type { CSSProperties, SyntheticEvent } from "react";

type ToolLogoSource = { domain: string } | { src: string };

/**
 * Real brand logo for a métier tool / integration. Every product with a public web presence maps to
 * its official domain and renders through Google's favicon endpoint, which is much more complete for
 * niche French vertical SaaS than DuckDuckGo's icon index. Platform concepts use local assets.
 *
 * Note: external image. The app has no CSP today; if one is added in prod, allow
 * `img-src https://www.google.com` (or self-host the icons).
 */
const TOOL_LOGOS: Record<string, ToolLogoSource> = {
  // notaires
  "Genapi (iNot)": { domain: "genapi.fr" },
  Fichorga: { domain: "fichorga.com" },
  Fiducial: { domain: "fiducial.fr" },
  Yousign: { domain: "yousign.com" },
  Infogreffe: { domain: "infogreffe.fr" },
  Comedec: { domain: "ants.gouv.fr" },
  // home-care
  Ogust: { domain: "ogust.com" },
  Apologic: { domain: "apologic.fr" },
  Ximi: { domain: "ximi.fr" },
  Domatel: { domain: "arche-mc2.fr" },
  // courtiers / common
  CourtiGo: { domain: "courtigo.fr" },
  Antenia: { domain: "antenia.fr" },
  "EDI Courtage NEO": { domain: "edicourtage.fr" },
  WhatsApp: { domain: "whatsapp.com" },
  "Gmail / Outlook": { src: "/integrations/google-gmail.svg" },
  "Any API / MCP": { src: "/integrations/mcp.svg" },
  // experts-comptables
  "Sage Coala": { domain: "sage.com" },
  "Sage Batigest": { domain: "sage.com" },
  "Cegid Expert": { domain: "cegid.com" },
  "ACD (Cador)": { domain: "acd-groupe.fr" },
  Agiris: { domain: "agiris.fr" },
  RCA: { domain: "rca.fr" },
  Pennylane: { domain: "pennylane.com" },
  // pharmacies
  LGPI: { domain: "pharmagest.com" },
  Winpharma: { domain: "winpharma.com" },
  "Smart RX": { domain: "smart-rx.com" },
  LEO: { domain: "leo-officine.fr" },
  Pharmaland: { domain: "pharmaland.fr" },
  // ehpad
  NetSoins: { domain: "socialcare.orisha.com" },
  "Orisha Socialcare": { domain: "socialcare.orisha.com" },
  Ségur: { domain: "esante.gouv.fr" },
  Posos: { domain: "posos.co" },
  Titan: { domain: "malta-informatique.fr" },
  Teranga: { domain: "socialcare.orisha.com" },
  MedgicNet: { domain: "medgicnet.com" },
  // syndics
  Gercop: { domain: "gercop.com" },
  ICS: { domain: "ics.fr" },
  Vilogi: { domain: "vilogi.com" },
  Thetrawin: { domain: "seiitra.com" },
  Powimo: { domain: "seiitra.com" },
  Seiitra: { domain: "seiitra.com" },
  Even: { domain: "realestate.orisha.com" },
  Gimini: { domain: "timci.com" },
  // hôtellerie
  Mews: { domain: "mews.com" },
  Medialog: { domain: "medialog.fr" },
  Reservit: { domain: "reservit.com" },
  "D-EDGE": { domain: "d-edge.com" },
  "Septeo Hospitality": { domain: "septeo.com" },
  // artisans bâtiment
  Batappli: { domain: "batappli.fr" },
  Obat: { domain: "obat.fr" },
  "EBP Bâtiment": { domain: "ebp.com" },
  Codial: { domain: "codial.fr" },
  Tolteck: { domain: "tolteck.com" },
  Extrabat: { domain: "extrabat.com" },
  // vétérinaires
  Vetocom: { domain: "vetocom.fr" },
  Bourgelat: { domain: "bourgelat.fr" },
  Vetup: { domain: "vetup.com" },
  DrVeto: { domain: "drveto.com" },
  VetoPartner: { domain: "vetopartner.fr" },
};

const MONO_PALETTE = ["#D52B0C", "#E8A33D", "#2E8B57", "#6E5C53", "#3C1E0A", "#B0240A"];
const IMAGE_STYLE_CACHE = new Map<number, CSSProperties>();
const MONOGRAM_STYLE_CACHE = new Map<string, CSSProperties>();

function monogramColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return MONO_PALETTE[hash % MONO_PALETTE.length];
}

function imageStyle(size: number): CSSProperties {
  const cached = IMAGE_STYLE_CACHE.get(size);
  if (cached) {
    return cached;
  }
  const style = { width: size, height: size };
  IMAGE_STYLE_CACHE.set(size, style);
  return style;
}

function monogramStyle(name: string, size: number): CSSProperties {
  const key = `${name}:${size}`;
  const cached = MONOGRAM_STYLE_CACHE.get(key);
  if (cached) {
    return cached;
  }
  const style = {
    width: size,
    height: size,
    backgroundColor: monogramColor(name),
    fontSize: size * 0.5,
  };
  MONOGRAM_STYLE_CACHE.set(key, style);
  return style;
}

function logoSrc(source: ToolLogoSource, size: number): string {
  return "src" in source
    ? source.src
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.domain)}&sz=${Math.max(32, size * 2)}`;
}

function hideBrokenLogo(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
}

function Monogram({ name, size }: { name: string; size: number }) {
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      style={monogramStyle(name, size)}
      className="flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white"
    >
      {letter}
    </span>
  );
}

export function ToolLogo({ name, size = 20 }: { name: string; size?: number }) {
  const source = TOOL_LOGOS[name];

  if (!source) {
    return <Monogram name={name} size={size} />;
  }
  return (
    <span
      aria-hidden
      style={imageStyle(size)}
      className="relative flex shrink-0 items-center justify-center"
    >
      <Monogram name={name} size={size} />
      <img
        src={logoSrc(source, size)}
        alt=""
        loading="lazy"
        onError={hideBrokenLogo}
        style={imageStyle(size)}
        className="absolute inset-0 rounded-[5px] bg-white object-contain"
      />
    </span>
  );
}
