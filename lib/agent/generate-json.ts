import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ZodType } from "zod";

// Extract a JSON object from raw model text and parse it. Robust to the things
// reasoning models do: markdown fences, prose around the object, and trailing
// commas. Throws if no object is present or it cannot be parsed.
export function extractObject(text: string): unknown {
  let s = text.trim();
  // Strip a leading ```json / ``` fence and a trailing ``` fence.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object found in model output");
  }
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    // Last-resort: strip trailing commas before } or ] and retry once.
    return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1"));
  }
}

// Try to extract + schema-validate one model output. Returns the parsed value
// or an Error describing what was wrong (so the caller can ask for a repair).
function tryParse<T>(text: string, schema: ZodType<T>): T | Error {
  try {
    return schema.parse(extractObject(text));
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

// Generate a schema-validated object from a chat model using plain text
// completion (not the provider's structured-output mode, which gpt-oss-120b on
// OpenRouter does not support). The system prompt instructs the model to emit
// JSON only; we extract + Zod-validate, and on a mismatch make ONE repair
// attempt that feeds the bad output and the validation error back to the model.
// Throws if the repair also fails — the graph turns that into a typed error.
export async function generateJson<T>(args: {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  signal: AbortSignal;
  maxOutputTokens?: number;
}): Promise<T> {
  const { model, system, prompt, schema, signal, maxOutputTokens = 4096 } = args;

  const first = await generateText({ model, system, prompt, maxOutputTokens, abortSignal: signal });
  const parsed = tryParse(first.text, schema);
  if (!(parsed instanceof Error)) return parsed;

  // One repair attempt: show the model its own output and the exact problem.
  const repairPrompt = `${prompt}

Your previous response did not match the required JSON schema and was rejected with this error:
${parsed.message}

Here is what you returned:
${first.text}

Return ONLY a corrected JSON object that fully satisfies the schema. No prose, no markdown fences.`;
  const repaired = await generateText({
    model,
    system,
    prompt: repairPrompt,
    maxOutputTokens,
    abortSignal: signal,
  });
  const reparsed = tryParse(repaired.text, schema);
  if (reparsed instanceof Error) throw reparsed;
  return reparsed;
}
