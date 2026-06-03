import type { ImgHTMLAttributes } from "react";

/**
 * Platform-native image primitive replacing `next/image` inside shared components.
 *
 * Renders a plain <img> with explicit width/height plus sensible loading/decoding defaults.
 * No layout shift magic, no loader pipeline: assets are served from `public/` or remote URLs
 * exactly as the rest of the migrated tree does.
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
