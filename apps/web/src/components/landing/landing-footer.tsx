import type { ChangeEvent, FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ChevronDown, Globe2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useAppLocale } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";

const LANDING_LOCALE_NAMES = {
  en: "English",
  fr: "Français",
} as const;

export function LandingLocaleSelector({ placement = "hero" }: { placement?: "hero" | "footer" }) {
  const t = useGT();

  const { locale, locales, setLocale } = useAppLocale();
  const selectRef = useRef<HTMLSelectElement>(null);
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement> | FormEvent<HTMLSelectElement>) => {
      setLocale(event.currentTarget.value);
    },
    [setLocale],
  );
  const selectClassName =
    placement === "hero"
      ? "border-white/45 bg-white/80 text-slate-900 shadow-sm hover:bg-white"
      : "border-border/70 bg-background/80 text-foreground shadow-xs hover:bg-muted/50";

  useEffect(() => {
    const select = selectRef.current;
    if (!select) {
      return;
    }

    const handleNativeChange = () => setLocale(select.value);
    select.addEventListener("change", handleNativeChange);
    select.addEventListener("input", handleNativeChange);
    return () => {
      select.removeEventListener("change", handleNativeChange);
      select.removeEventListener("input", handleNativeChange);
    };
  }, [setLocale]);

  return (
    <div className="relative inline-flex items-center">
      <Globe2 className="text-muted-foreground pointer-events-none absolute left-2 size-3.5" />
      <select
        ref={selectRef}
        aria-label={t("Language")}
        className={`focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-[112px] appearance-none rounded-md border py-0 pr-7 pl-7 text-xs font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-[3px] ${selectClassName}`}
        value={locale}
        onChange={handleChange}
        onInput={handleChange}
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {LANDING_LOCALE_NAMES[option as keyof typeof LANDING_LOCALE_NAMES] ?? option}
          </option>
        ))}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute right-2 size-3.5" />
    </div>
  );
}

// ─── CTA + Footer (anonymous visitors only) ───────────────────────────────────

export function LandingFooterSection() {
  const t = useGT();

  return (
    <>
      {/* ── CTA ── */}
      <section className="border-border/40 relative overflow-hidden border-t bg-slate-950 px-6 py-24 md:py-36">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.08),transparent_70%)]" />
        <div className="relative mx-auto max-w-xl text-center">
          <h2 className="mb-5 text-3xl font-bold tracking-tight text-white md:text-[2.75rem] md:leading-[1.15]">
            <T>Deploy your first AI coworker today</T>
          </h2>
          <p className="mx-auto mb-10 max-w-sm text-base leading-relaxed text-slate-400">
            <T>Start free. Build your first AI coworker in minutes.</T>
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              asChild
              className="bg-white px-8 text-slate-950 shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:bg-slate-100"
            >
              <a
                href="https://cal.com/hyperstack/try-bap"
                target="_blank"
                rel="noopener noreferrer"
              >
                <T>Book a Demo</T>
              </a>
            </Button>
          </div>
          <div className="mt-6 flex items-center justify-center">
            <a
              href="https://github.com/baptistecolle/bap"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <T>Star us on GitHub</T>
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-border/40 bg-background border-t px-6 py-10 md:py-14">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            {/* Brand */}
            <div className="max-w-xs">
              <p className="text-foreground text-sm font-semibold">
                <T>Bap</T>
              </p>
              <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                <T>AI coworkers that connect to your tools and automate work across your team.</T>
              </p>
              <div className="mt-4 flex items-center gap-3">
                <a
                  href="https://github.com/baptistecolle/bap"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t("GitHub")}
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                </a>
                <a
                  href="https://discord.com/invite/NHQy8gXerd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t("Discord")}
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Links */}
            <div className="flex gap-12 md:gap-16">
              <div>
                <p className="text-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                  <T>Product</T>
                </p>
                <nav className="text-muted-foreground flex flex-col gap-2 text-xs">
                  <a
                    href="https://docs.heybap.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                  >
                    <T>Docs</T>
                  </a>
                  <Link to="/pricing" className="hover:text-foreground transition-colors">
                    <T>Pricing</T>
                  </Link>
                  <Link to="/templates" className="hover:text-foreground transition-colors">
                    <T>Templates</T>
                  </Link>
                </nav>
              </div>
              <div>
                <p className="text-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                  <T>Company</T>
                </p>
                <nav className="text-muted-foreground flex flex-col gap-2 text-xs">
                  <Link to="/support" className="hover:text-foreground transition-colors">
                    <T>Support</T>
                  </Link>
                  <Link to="/legal/terms" className="hover:text-foreground transition-colors">
                    <T>Terms</T>
                  </Link>
                  <Link
                    to="/legal/privacy-policy"
                    className="hover:text-foreground transition-colors"
                  >
                    <T>Privacy</T>
                  </Link>
                </nav>
              </div>
            </div>
          </div>

          {/* Bottom line */}
          <div className="border-border/40 text-muted-foreground/60 mt-10 flex flex-col gap-4 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div>
              <T>&copy;</T> {new Date().getFullYear()} <T>Bap. All rights reserved.</T>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs font-medium">
                <T>Language</T>
              </span>
              <LandingLocaleSelector placement="footer" />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
