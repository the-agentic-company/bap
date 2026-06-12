import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = dirname(currentFilename);
const repoRoot = resolve(currentDirname, "../../..");
const outputDir = resolve(repoRoot, ".github/assets/readme");
const mp4Path = join(outputDir, "cmdclaw-agent-inbox.mp4");
const gifPath = join(outputDir, "cmdclaw-agent-inbox.gif");
const posterPath = join(outputDir, "cmdclaw-agent-inbox.png");
const previewUrl =
  process.env.CMDCLAW_README_PREVIEW_URL ?? "http://127.0.0.1:3000/internal/readme-preview";

const width = 1440;
const height = 900;
const fps = 20;
const durationMs = 8000;
const totalFrames = Math.round((durationMs / 1000) * fps);

async function waitForPreview(page: Page) {
  let lastError: unknown = null;

  async function attemptLoad(attempt: number): Promise<void> {
    if (attempt >= 20) {
      throw new Error(
        `Preview route was not reachable at ${previewUrl}. Start the web app and try again.\n${String(lastError)}`,
      );
    }

    try {
      const response = await page.goto(previewUrl, {
        waitUntil: "domcontentloaded",
        timeout: 3000,
      });
      if (response?.ok()) {
        await page.waitForLoadState("networkidle");
        return;
      }
      lastError = new Error(`Unexpected status ${response?.status() ?? "unknown"}`);
    } catch (error) {
      lastError = error;
    }

    await page.waitForTimeout(500);
    return attemptLoad(attempt + 1);
  }

  return attemptLoad(0);
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "cmdclaw-readme-preview-"));
  const framesDir = join(tempRoot, "frames");
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  try {
    await waitForPreview(page);

    await page.addStyleTag({
      content: `
        html { scroll-behavior: auto !important; }
        html, body { scrollbar-width: none !important; }
        ::-webkit-scrollbar { display: none !important; }
      `,
    });

    // Wait for initial animations to start
    await page.waitForTimeout(600);

    async function captureFrame(frame: number): Promise<void> {
      if (frame >= totalFrames) {
        return;
      }
      await page.waitForTimeout(Math.round(1000 / fps));
      await page.screenshot({
        path: join(framesDir, `frame-${String(frame).padStart(4, "0")}.png`),
      });
      return captureFrame(frame + 1);
    }
    await captureFrame(0);

    // Poster: capture a frame after some animation has played
    await page.waitForTimeout(300);
    await page.screenshot({ path: posterPath });
  } finally {
    await browser.close();
  }

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(framesDir, "frame-%04d.png"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4Path,
    ],
    { stdio: "inherit" },
  );

  const palettePath = join(tempRoot, "palette.png");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      mp4Path,
      "-update",
      "1",
      "-frames:v",
      "1",
      "-vf",
      "fps=15,scale=1100:-1:flags=lanczos,palettegen",
      palettePath,
    ],
    { stdio: "inherit" },
  );

  await access(palettePath);

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      mp4Path,
      "-i",
      palettePath,
      "-lavfi",
      "fps=15,scale=1100:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4",
      gifPath,
    ],
    { stdio: "inherit" },
  );

  await rm(tempRoot, { recursive: true, force: true });
}

await main();
