import type { AnchorHTMLAttributes, FC, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import * as React from "react";
import { useId, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Raw-href link view, replacing raw href links. Tabs build string hrefs rather than
 * TanStack's typed `to`, so this wraps TanStack `Link`'s `href` escape hatch while
 * keeping client-side navigation. The cast is contained to this primitive.
 */
type HrefLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};
const HrefLink = Link as unknown as FC<HrefLinkProps>;

const ACTIVE_TAB_PILL_TRANSITION = { type: "spring", stiffness: 400, damping: 30 } as const;

/* ─── AnimatedTabs ─── */

type AnimatedTabsProps = {
  activeKey: string;
  onTabChange?: (key: string) => void;
  children: React.ReactNode;
  className?: string;
};

function AnimatedTabs({ activeKey, onTabChange, children, className }: AnimatedTabsProps) {
  const id = useId();
  const stableId = useRef(id);
  const layoutId = `tab-pill-${stableId.current}`;

  return (
    <div
      role="tablist"
      className={cn("inline-flex items-center gap-0.5 rounded-lg p-1", className)}
    >
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<AnimatedTabProps>(child)) {
          return child;
        }
        const tabValue = child.props.value;
        return React.cloneElement(child, {
          _active: tabValue === activeKey,
          _layoutId: layoutId,
          _onSelect: onTabChange,
        });
      })}
    </div>
  );
}

/* ─── AnimatedTab ─── */

type AnimatedTabProps = {
  value: string;
  children: React.ReactNode;
  href?: string;
  className?: string;
  /** @internal */ _active?: boolean;
  /** @internal */ _layoutId?: string;
  /** @internal */ _onSelect?: (key: string) => void;
};

function AnimatedTab({
  value,
  children,
  href,
  className,
  _active,
  _layoutId,
  _onSelect,
}: AnimatedTabProps) {
  const handleClick = React.useCallback(() => {
    _onSelect?.(value);
  }, [_onSelect, value]);

  const inner = (
    <>
      {_active && (
        <motion.span
          layoutId={_layoutId}
          className="bg-muted absolute inset-0 rounded-md"
          transition={ACTIVE_TAB_PILL_TRANSITION}
        />
      )}
      <span className="relative z-10">{children}</span>
    </>
  );

  const sharedClass = cn(
    "relative inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
    _active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
    className,
  );

  if (href) {
    return (
      <HrefLink href={href} role="tab" aria-selected={_active} className={sharedClass}>
        {inner}
      </HrefLink>
    );
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={_active}
      onClick={handleClick}
      className={sharedClass}
    >
      {inner}
    </button>
  );
}

export { AnimatedTabs, AnimatedTab };
