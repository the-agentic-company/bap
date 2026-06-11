import type { ReactNode } from "react";
import { GTProvider } from "gt-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import loadTranslations from "@/loadTranslations";
import gtConfig from "../../gt.config.json";

const DEFAULT_LOCALE = gtConfig.defaultLocale;
export const LOCALE_COOKIE_NAME = "generaltranslation.locale";
const GENERAL_TRANSLATION_LOCALES = gtConfig.locales;
const SUPPORTED_LOCALES = [DEFAULT_LOCALE, ...GENERAL_TRANSLATION_LOCALES];

type LocaleContextValue = {
  locale: string;
  locales: string[];
  setLocale: (locale: string) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function getInitialAppLocale() {
  if (typeof document === "undefined") {
    return DEFAULT_LOCALE;
  }

  const cookieLocale = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.split("=")[1];

  return cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
}

export function localizedText(en: string, translations: Partial<Record<string, string>>) {
  const locale = getInitialAppLocale();
  return locale === DEFAULT_LOCALE ? en : (translations[locale] ?? en);
}

function writeLocaleCookie(locale: string) {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/`;
}

export function GeneralTranslationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(getInitialAppLocale);
  const setLocale = useCallback((nextLocale: string) => {
    if (!SUPPORTED_LOCALES.includes(nextLocale)) {
      return;
    }

    writeLocaleCookie(nextLocale);
    setLocaleState(nextLocale);
  }, []);
  const localeContextValue = useMemo(
    () => ({ locale, locales: SUPPORTED_LOCALES, setLocale }),
    [locale, setLocale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <GTProvider
      environment={import.meta.env.DEV ? "development" : "production"}
      cacheUrl={null}
      defaultLocale={gtConfig.defaultLocale}
      enableI18n
      loadTranslations={loadTranslations}
      locale={locale}
      locales={GENERAL_TRANSLATION_LOCALES}
      runtimeUrl={null}
    >
      <LocaleContext.Provider value={localeContextValue}>{children}</LocaleContext.Provider>
    </GTProvider>
  );
}

export function useAppLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useAppLocale must be used inside GeneralTranslationProvider");
  }
  return context;
}
