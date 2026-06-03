"use client";

/**
 * Thin TanStack Router adapters that expose the small slice of the old `next/navigation`
 * surface the toolbox pages depend on.
 *
 * The toolbox list page and source detail page build raw string hrefs and drive navigation
 * with `router.push(href)` / `router.replace(href)`, read the current params, and read search
 * params via `URLSearchParams`. Rather than rewrite that stable product logic during the Big
 * Bang framework migration, this module maps that exact API onto TanStack Router's
 * `useNavigate` / `useRouterState` / `useParams`. It is route-local (lives under the toolbox
 * area) and is the only place those components touch routing.
 *
 * This is NOT a Next compatibility wrapper for the framework: it is a tiny local utility that
 * speaks TanStack Router under the hood. No `next/*` import exists here.
 */

import { useMemo } from "react";
import {
  useNavigate,
  useParams as useTanStackParams,
  useRouterState,
} from "@tanstack/react-router";

export function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

/**
 * Mirrors `next/navigation`'s `useParams<T>()`. Reads from TanStack's non-strict params so the
 * shared detail content can resolve its `id` segment regardless of which toolbox route is
 * currently active.
 */
export function useParams<T extends Record<string, string | undefined>>(): T {
  return useTanStackParams({ strict: false, shouldThrow: false }) as unknown as T;
}

export function useSearchParams(): URLSearchParams {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
}

export interface CompatRouter {
  push: (href: string) => void;
  replace: (href: string, options?: { scroll?: boolean }) => void;
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
