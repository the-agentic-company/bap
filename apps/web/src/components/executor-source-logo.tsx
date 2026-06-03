"use client";

import { Puzzle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppImage } from "@/components/app-image";
import { getBrandfetchLogoUrl } from "@/lib/brandfetch";
import { cn } from "@/lib/utils";

export function WorkspaceMcpServerLogo({
  endpoint,
  className,
  imgClassName,
  iconClassName,
}: {
  kind: "mcp";
  endpoint: string;
  className?: string;
  imgClassName?: string;
  iconClassName?: string;
}) {
  const logoUrl = getBrandfetchLogoUrl(endpoint);
  const [logoFailed, setLogoFailed] = useState(false);
  const handleError = useCallback(() => {
    setLogoFailed(true);
  }, []);

  useEffect(() => {
    setLogoFailed(false);
  }, [endpoint]);

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg",
        logoUrl && !logoFailed ? "border bg-white p-1 shadow-sm" : "bg-muted/60",
        className,
      )}
    >
      {logoUrl && !logoFailed ? (
        <AppImage
          src={logoUrl}
          alt=""
          width={80}
          height={80}
          className={cn("h-full w-full rounded-md object-contain", imgClassName)}
          onError={handleError}
        />
      ) : (
        <Puzzle className={cn("text-foreground h-5 w-5", iconClassName)} />
      )}
    </div>
  );
}
