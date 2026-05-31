import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { ALLOWED_ORIGINS } from "@/lib/config";

// Same model and OpenRouter attribution headers as the pre-AI-SDK route.
// `:free` variant — drop the suffix for the paid variant.
export const DEFAULT_MODEL = "openai/gpt-oss-120b:free";

// The key is read at call time (never cached at import) so Docker-secret
// rotation keeps working.
export function getModel(apiKey: string, modelId: string = DEFAULT_MODEL): LanguageModel {
  const provider = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": ALLOWED_ORIGINS[0] ?? "http://localhost:7001",
      "X-Title": "Golden Circle Analyzer",
    },
  });
  return provider(modelId);
}
