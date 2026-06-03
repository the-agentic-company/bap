"use client";

import { AppImage } from "@/components/chat/app-image";
import {
  getIntegrationLogo,
  getIntegrationIcon,
  getIntegrationDisplayName,
  type DisplayIntegrationType,
} from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

type Props = {
  integrations: DisplayIntegrationType[];
  size?: "sm" | "md";
  className?: string;
};

export function IntegrationBadges({ integrations, size = "sm", className }: Props) {
  const visibleIntegrations = integrations.filter(
    (integration) => String(integration) !== "cmdclaw",
  );

  if (visibleIntegrations.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {visibleIntegrations.map((integration) => (
        <IntegrationBadge key={integration} integration={integration} size={size} />
      ))}
    </div>
  );
}

function IntegrationBadge({
  integration,
  size,
}: {
  integration: DisplayIntegrationType;
  size: "sm" | "md";
}) {
  const logo = getIntegrationLogo(integration);
  const Icon = getIntegrationIcon(integration);
  const name = getIntegrationDisplayName(integration);

  const sizeClasses = size === "sm" ? "px-1.5 py-0.5 text-xs gap-1" : "px-2 py-1 text-sm gap-1.5";

  const iconSize = size === "sm" ? "h-3 w-auto" : "h-4 w-auto";
  const iconPixels = size === "sm" ? 12 : 16;
  const nameMaxWidth = size === "sm" ? "max-w-[60px]" : "max-w-[80px]";

  return (
    <div
      className={cn(
        "flex items-center rounded-full bg-background/80 text-muted-foreground border border-border/50 hover:bg-background transition-colors",
        sizeClasses,
      )}
      title={name}
    >
      {logo ? (
        <AppImage src={logo} alt={name} width={iconPixels} height={iconPixels} className={iconSize} />
      ) : Icon ? (
        <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-4 w-4", "text-blue-500")} />
      ) : null}
      <span className={cn("truncate", nameMaxWidth)}>{name}</span>
    </div>
  );
}
