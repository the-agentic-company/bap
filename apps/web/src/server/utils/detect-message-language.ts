import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildDetectMessageLanguagePrompt } from "@bap/prompts";

export type DetectedMessageLanguage = "french" | "other";

export async function detectMessageLanguage(text: string): Promise<DetectedMessageLanguage> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return "other";
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.warn("[LanguageDetection] No GEMINI_API_KEY, defaulting to other");
    return "other";
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(buildDetectMessageLanguagePrompt(normalizedText));
    const responseText = result.response.text().trim().toLowerCase();

    return responseText.includes("french") ? "french" : "other";
  } catch (error) {
    console.error("[LanguageDetection] Failed to detect language:", error);
    return "other";
  }
}
