import type { ImgHTMLAttributes } from "react";

/**
 * Platform-native image primitive inside the chat area.
 *
 * Renders a plain <img> with explicit width/height plus sensible loading/decoding defaults.
 * Logos and attachment previews are served from `public/` or inline data URLs.
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
