import { bigSmile } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

type CoworkerAvatarProps = {
  username?: string | null;
  size?: number;
  className?: string;
};

export function CoworkerAvatar({ username, size = 32, className }: CoworkerAvatarProps) {
  const dataUri = useMemo(
    () => createAvatar(bigSmile, { seed: username ?? "default", size }).toDataUri(),
    [username, size],
  );

  return (
    // oxlint-disable-next-line nextjs/no-img-element -- data URI, no optimization needed
    <img
      src={dataUri}
      alt={username ? `@${username}` : "avatar"}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-lg", className)}
    />
  );
}
