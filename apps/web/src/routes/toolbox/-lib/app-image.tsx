import type { ImgHTMLAttributes } from "react";

/**
 * Platform-native image primitive replacing `next/image` inside the toolbox area.
 *
 * Renders a plain <img> with explicit width/height plus sensible loading/decoding defaults.
 * Integration / skill logos are served from `public/` exactly as the rest of the migrated
 * tree does, so no loader pipeline is needed.
 */
export interface AppImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export function AppImage({
  src,
  alt,
  width,
  height,
  loading = "lazy",
  decoding = "async",
  ...rest
}: AppImageProps) {
  return (
    // Platform-native image is the intended TanStack Start replacement for next/image; the
    // Next no-img-element rule is a false positive here and is dropped when the Next lint
    // integration is removed in a later migration phase (same handling as src/routes/__root.tsx).
    // oxlint-disable-next-line nextjs/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      {...rest}
    />
  );
}
