"use client";

/**
 * Thin TanStack Router adapters that expose the small slice of the old `next/navigation`
 * surface the prototype info component depends on.
 *
 * The coworker info prototype builds raw string hrefs and drives navigation with
 * `router.push(href)`, plus reads the current search params (`run`). Rather than rewrite the
 * stable prototype logic during the Big Bang framework migration, this module maps that exact
 * API onto TanStack Router's `useNavigate` / `useRouterState`. It is route-local (lives under
 * the prototype area) and is the only place this component touches routing.
 *
 * This is NOT a Next compatibility wrapper for the framework: it is a tiny local utility that
 * speaks TanStack Router under the hood. No `next/*` import exists here.
 */

import { useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

export function useSearchParams(): URLSearchParams {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
}

export interface CompatRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
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
    }),
    [navigate],
  );
}
