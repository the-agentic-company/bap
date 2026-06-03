"use client";

import type { AnchorHTMLAttributes, FC, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Raw-href link primitive for the toolbox area, replacing `next/link`.
 *
 * Toolbox cards build string hrefs (including `/toolbox?preview=...`, `/skills/<id>`, and
 * `/toolbox/sources/<id>`) rather than using TanStack's typed `to`. This wraps TanStack
 * `Link`'s `href` escape hatch so client-side navigation keeps working while the call sites
 * stay identical to the old `<Link href=...>` shape. The Next-only `scroll` prop is accepted
 * and dropped (TanStack does not scroll-restore on hash-style preview navigations here).
 */
export interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
  scroll?: boolean;
}

// TanStack `Link`'s public type insists on a typed `to`, so we reference it through a local
// loosely-typed view that accepts the `href` escape hatch. The cast is contained to this one
// primitive; runtime behavior is plain TanStack Router navigation.
const HrefLink = Link as unknown as FC<AppLinkProps>;

export function AppLink({ href, children, scroll: _scroll, ...rest }: AppLinkProps) {
  return (
    <HrefLink href={href} {...rest}>
      {children}
    </HrefLink>
  );
}
