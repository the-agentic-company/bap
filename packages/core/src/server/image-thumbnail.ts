import sharp from "sharp";

export const IMAGE_THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_THUMBNAIL_MAX_PIXELS = 24_000_000;
const IMAGE_THUMBNAIL_SIZE = 128;
const IMAGE_THUMBNAIL_OUTPUT_EXTENSION = "webp";
const IMAGE_THUMBNAIL_OUTPUT_MIME_TYPE = "image/webp";

export const IMAGE_THUMBNAIL_INPUT_EXTENSIONS = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ImageThumbnailInputMimeType = keyof typeof IMAGE_THUMBNAIL_INPUT_EXTENSIONS;

function decodeImageThumbnailInput(input: {
  contentBase64: string;
  mimeType: ImageThumbnailInputMimeType;
}): Buffer {
  if (!IMAGE_THUMBNAIL_INPUT_EXTENSIONS[input.mimeType]) {
    throw new Error("Unsupported image type");
  }

  const normalizedBase64 = input.contentBase64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedBase64)) {
    throw new Error("Image content is not valid base64");
  }

  const buffer = Buffer.from(normalizedBase64, "base64");
  if (buffer.byteLength === 0) {
    throw new Error("Image is empty");
  }
  if (buffer.byteLength > IMAGE_THUMBNAIL_MAX_BYTES) {
    throw new Error("Image must be 10 MB or smaller");
  }

  return buffer;
}

export async function convertImageThumbnail(input: {
  contentBase64: string;
  mimeType: ImageThumbnailInputMimeType;
}): Promise<{
  buffer: Buffer;
  dataUrl: string;
  extension: typeof IMAGE_THUMBNAIL_OUTPUT_EXTENSION;
  mimeType: typeof IMAGE_THUMBNAIL_OUTPUT_MIME_TYPE;
}> {
  const sourceBuffer = decodeImageThumbnailInput(input);

  try {
    const buffer = await sharp(sourceBuffer, {
      animated: false,
      limitInputPixels: IMAGE_THUMBNAIL_MAX_PIXELS,
    })
      .rotate()
      .resize(IMAGE_THUMBNAIL_SIZE, IMAGE_THUMBNAIL_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();

    if (buffer.byteLength === 0) {
      throw new Error("Image is empty after processing");
    }

    return {
      buffer,
      dataUrl: `data:${IMAGE_THUMBNAIL_OUTPUT_MIME_TYPE};base64,${buffer.toString("base64")}`,
      extension: IMAGE_THUMBNAIL_OUTPUT_EXTENSION,
      mimeType: IMAGE_THUMBNAIL_OUTPUT_MIME_TYPE,
    };
  } catch {
    throw new Error("Image could not be processed");
  }
}
