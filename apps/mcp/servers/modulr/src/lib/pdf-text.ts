import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { PDFParse } from "pdf-parse";

const DEFAULT_MAX_CHARACTERS = 20_000;
let workerConfigured = false;
const require = createRequire(import.meta.url);

function getPdfWorkerPath() {
  const entryPath = require.resolve("pdf-parse");
  const workerPath = resolve(dirname(entryPath), "..", "..", "worker", "pdf.worker.mjs");
  if (!existsSync(workerPath)) {
    throw new Error(`Could not locate pdf-parse worker at ${workerPath}.`);
  }
  return workerPath;
}

function configurePdfWorker() {
  if (workerConfigured) {
    return;
  }
  PDFParse.setWorker(getPdfWorkerPath());
  workerConfigured = true;
}

export async function extractPdfTextFromBase64(
  base64: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
) {
  configurePdfWorker();
  const bytes = Buffer.from(base64, "base64");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    return {
      text: text.length > maxCharacters ? `${text.slice(0, maxCharacters).trimEnd()}\n[truncated]` : text,
      pageCount: result.total,
      truncated: text.length > maxCharacters,
      characterCount: text.length,
    };
  } finally {
    await parser.destroy();
  }
}
