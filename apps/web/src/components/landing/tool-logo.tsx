import { useMemo } from "react";

/**
 * Small brand logo for a métier tool / integration. When we know the tool's domain we show its
 * real favicon (the site's own icon) via Google's favicon service; otherwise we fall back to a
 * tasteful monogram in the warm brand palette. Used in tool chips on the vertical pages and in
 * the agent modal.
 *
 * Note: the favicon is an external image. The app has no CSP today; if one is added in prod,
 * allow `img-src https://www.google.com` (or self-host the icons).
 */

// High-confidence domains only. Unknown tools render a monogram (better than a wrong favicon).
const TOOL_DOMAINS: Record<string, string> = {
  "Genapi (iNot)": "genapi.fr",
  Fichorga: "fichorga.com",
  Fiducial: "fiducial.fr",
  Yousign: "yousign.com",
  Infogreffe: "infogreffe.fr",
  Ogust: "ogust.com",
  Apologic: "apologic.fr",
  Antenia: "antenia.com",
  WhatsApp: "whatsapp.com",
  "Sage Coala": "sage.com",
  "Sage Batigest": "sage.com",
  "Cegid Expert": "cegid.com",
  Agiris: "agiris.fr",
  RCA: "rca.fr",
  Pennylane: "pennylane.com",
  Winpharma: "winpharma.com",
  LEO: "leo-officine.fr",
  NetSoins: "teranga-software.com",
  Teranga: "teranga-software.com",
  "Orisha Socialcare": "orisha.com",
  Posos: "posos.co",
  MedgicNet: "medgicnet.com",
  Vilogi: "vilogi.com",
  Mews: "mews.com",
  Reservit: "reservit.com",
  "D-EDGE": "d-edge.com",
  "Septeo Hospitality": "septeo.com",
  "EBP Bâtiment": "ebp.com",
  Tolteck: "tolteck.com",
  Extrabat: "extrabat.com",
  Batappli: "batappli.fr",
  Obat: "obat.fr",
  Vetup: "vetup.com",
  DrVeto: "drveto.com",
};

const MONO_PALETTE = ["#D52B0C", "#E8A33D", "#2E8B57", "#6E5C53", "#3C1E0A", "#B0240A"];

function monogramColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return MONO_PALETTE[hash % MONO_PALETTE.length];
}

export function ToolLogo({ name, size = 16 }: { name: string; size?: number }) {
  const domain = TOOL_DOMAINS[name];
  const imgStyle = useMemo(() => ({ width: size, height: size }), [size]);
  const monoStyle = useMemo(
    () => ({
      width: size,
      height: size,
      backgroundColor: monogramColor(name),
      fontSize: size * 0.55,
    }),
    [name, size],
  );

  if (domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        loading="lazy"
        style={imgStyle}
        className="shrink-0 rounded-[4px] object-contain"
      />
    );
  }

  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      style={monoStyle}
      className="flex shrink-0 items-center justify-center rounded-[4px] font-semibold text-white"
    >
      {letter}
    </span>
  );
}
