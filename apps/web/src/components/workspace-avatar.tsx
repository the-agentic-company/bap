import { useCallback, useEffect, useState } from "react";
import { AppImage } from "@/components/app-image";
import { cn } from "@/lib/utils";

export function WorkspaceAvatar({
  className,
  decoding,
  imageUrl,
  loading,
  name,
}: {
  className?: string;
  decoding?: "async" | "auto" | "sync";
  imageUrl?: string | null;
  loading?: "eager" | "lazy";
  name: string;
}) {
  const initial = (name.trim().charAt(0) || "W").toUpperCase();
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(imageUrl) && !imageFailed;
  const handleImageError = useCallback(() => {
    setImageFailed(true);
  }, []);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-semibold",
        className,
      )}
      aria-hidden="true"
    >
      {shouldShowImage ? (
        <AppImage
          src={imageUrl!}
          alt=""
          width={64}
          height={64}
          loading={loading}
          decoding={decoding}
          onError={handleImageError}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
