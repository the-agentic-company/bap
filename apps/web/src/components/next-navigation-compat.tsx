"use client";

/**
 * Thin TanStack Router adapters that expose the small slice of the old `next/navigation`
 * surface that shared (non-route) components depend on.
 *
 * Several shared components (sidebar, mobile navigation, posthog provider, modals) build raw
 * string hrefs and drive navigation with `router.push(href)` / `router.replace(href)`, plus read
 * the current pathname and search params. Rather than rewrite that stable logic during the Big
 * Bang framework migration, this module maps that exact API onto TanStack Router's `useNavigate`
 * / `useRouterState`. No `next/*` import exists here.
 *
 * This is NOT a Next compatibility wrapper for the framework: it is a tiny shared utility that
 * speaks TanStack Router under the hood.
 */

import { useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

export function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function useSearchParams(): URLSearchParams {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
}

export interface CompatRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
}

export function useRouter(): CompatRouter {
  const navigate = useNavigate();
  return useMemo<CompatRouter>(
    () => ({
      push: (href: string) => {
        void navigate({ href });
      },
      replace: (href: string) => {
        void navigate({ href, replace: true });
      },
      back: () => {
        if (typeof window !== "undefined") {
          window.history.back();
        }
      },
    }),
    [navigate],
  );
}
