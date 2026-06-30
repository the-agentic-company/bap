import { useCallback, useMemo, useState } from "react";

/**
 * Real brand logo for a métier tool / integration. We use DuckDuckGo's icon service, which returns
 * solid full-color brand icons and cleanly 404s when it has none, so we can fall back to a tasteful
 * colored monogram instead of a broken/blank image. Every tool is mapped to its domain; the handful
 * of ultra-niche tools DDG doesn't index (and non-products like "Any API / MCP") show the monogram.
 *
 * Note: external image. The app has no CSP today; if one is added in prod, allow
 * `img-src https://icons.duckduckgo.com` (or self-host the icons).
 */
// Only domains that DuckDuckGo actually serves a real icon for. Tools whose domain has no public
// favicon (a dozen ultra-niche French SaaS, plus non-products like "Any API / MCP") are omitted on
// purpose so they render a clean monogram rather than DDG's invisible placeholder.
const TOOL_DOMAINS: Record<string, string> = {
  // notaires
  "Genapi (iNot)": "genapi.fr",
  Fichorga: "fichorga.com",
  Fiducial: "fiducial.fr",
  Yousign: "yousign.com",
  Infogreffe: "infogreffe.fr",
  // courtiers / common
  WhatsApp: "whatsapp.com",
  "Gmail / Outlook": "gmail.com",
  // experts-comptables
  "Sage Coala": "sage.com",
  "Sage Batigest": "sage.com",
  "Cegid Expert": "cegid.com",
  "ACD (Cador)": "acd-groupe.fr",
  Agiris: "agiris.fr",
  RCA: "rca.fr",
  Pennylane: "pennylane.com",
  // pharmacies
  Winpharma: "winpharma.com",
  LEO: "leo-officine.fr",
  // ehpad
  "Orisha Socialcare": "orisha.com",
  Ségur: "esante.gouv.fr",
  Posos: "posos.co",
  // syndics
  Gercop: "gercop.com",
  Powimo: "powimo.com",
  Seiitra: "seiitra.com",
  // hôtellerie
  Mews: "mews.com",
  Medialog: "medialog.fr",
  Reservit: "reservit.com",
  "D-EDGE": "d-edge.com",
  "Septeo Hospitality": "septeo.com",
  // artisans bâtiment
  Batappli: "batappli.fr",
  Obat: "obat.fr",
  "EBP Bâtiment": "ebp.com",
  Codial: "codial.fr",
  Tolteck: "tolteck.com",
  Extrabat: "extrabat.com",
  // vétérinaires
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

function Monogram({ name, size }: { name: string; size: number }) {
  const style = useMemo(
    () => ({ width: size, height: size, backgroundColor: monogramColor(name), fontSize: size * 0.5 }),
    [name, size],
  );
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      style={style}
      className="flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white"
    >
      {letter}
    </span>
  );
}

export function ToolLogo({ name, size = 20 }: { name: string; size?: number }) {
  const domain = TOOL_DOMAINS[name];
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const imgStyle = useMemo(() => ({ width: size, height: size }), [size]);

  if (!domain || failed) {
    return <Monogram name={name} size={size} />;
  }
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      loading="lazy"
      onError={onError}
      style={imgStyle}
      className="shrink-0 rounded-[5px] object-contain"
    />
  );
}
