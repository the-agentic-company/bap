export function encodeUtf16Be(text: string): Buffer {
  const buffer = Buffer.alloc(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.charCodeAt(index);
    buffer[index * 2] = (codePoint >> 8) & 0xff;
    buffer[index * 2 + 1] = codePoint & 0xff;
  }
  return buffer;
}

export function containsPdfText(pdfBytes: Buffer, expectedText: string): boolean {
  const binary = pdfBytes.toString("latin1");
  const variants = Array.from(
    new Set([expectedText, expectedText.toLowerCase(), expectedText.toUpperCase()]),
  );

  for (const variant of variants) {
    if (pdfBytes.includes(Buffer.from(variant))) {
      return true;
    }

    if (pdfBytes.includes(encodeUtf16Be(variant))) {
      return true;
    }

    const utf16Hex = encodeUtf16Be(variant).toString("hex").toUpperCase();
    if (
      binary.includes(`<${utf16Hex}>`) ||
      binary.includes(`<FEFF${utf16Hex}>`) ||
      binary.includes(`<feff${utf16Hex.toLowerCase()}>`)
    ) {
      return true;
    }
  }

  return false;
}
