import type { ImgHTMLAttributes } from "react";

/**
 * Platform-native image primitive inside the admin area.
 *
 * Renders a plain <img> with explicit width/height plus sensible loading/decoding defaults.
 * Assets are served from `public/`.
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
