"use client";

import type { AnchorHTMLAttributes, FC, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Raw-href link primitive for the prototype area, replacing `next/link`.
 *
 * The migrated prototype page builds string hrefs (the dynamic `/agents/edit/<id>` configure
 * link) rather than using TanStack's typed `to`. This wraps TanStack `Link`'s `href` escape
 * hatch so client-side navigation still works while keeping call sites identical to the old
 * `<Link href=...>` shape.
 *
 * TanStack `Link`'s public type insists on a typed `to`, so we reference it through a local
 * loosely-typed view that accepts the `href` escape hatch. The cast is contained to this one
 * primitive; runtime behavior is plain TanStack Router navigation.
 */
export interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
}

const HrefLink = Link as unknown as FC<AppLinkProps>;

export function AppLink({ href, children, ...rest }: AppLinkProps) {
  return (
    <HrefLink href={href} {...rest}>
      {children}
    </HrefLink>
  );
}
