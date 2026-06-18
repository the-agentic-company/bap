import type { AnchorHTMLAttributes, FC, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * String-path link primitive for the agents area, replacing raw href links.
 *
 * The migrated agents pages build string hrefs (including dynamic `/agents/edit/<slug>` and
 * `/agents/info/<slug>?...` paths) rather than using TanStack's typed `to`. This wraps
 * TanStack `Link` with a loose string `to` so client-side navigation still works while keeping
 * call sites identical to the old `<Link href=...>` shape.
 *
 * TanStack `Link`'s public type insists on a typed `to`, so we reference it through a local
 * loosely-typed view. The cast is contained to this one primitive; runtime behavior is plain
 * TanStack Router navigation.
 */
export interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
}

const StringPathLink = Link as unknown as FC<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    to: string;
    children: ReactNode;
  }
>;

export function AppLink({ href, children, ...rest }: AppLinkProps) {
  return (
    <StringPathLink to={href} {...rest}>
      {children}
    </StringPathLink>
  );
}
