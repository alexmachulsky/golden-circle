import type { AnalysisResult, HowItem, WhatItem } from '@/types';

const INVISIBLE_TEXT_RE = /[\x00-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Parses and strictly validates a raw LLM response string into AnalysisResult.
 *
 * Strips markdown code fences, extracts the outermost JSON object, fixes
 * trailing commas, then enforces the exact schema required by the app:
 *   - why.statement and why.depth_note must be non-empty strings
 *   - how must be exactly 4 items, each with title / description / uniqueness
 *   - what must be exactly 3 items, each with title / description / why_connection
 *   - positioning_note must be a non-empty string
 *
 * Throws Error('Invalid analysis response') if any constraint is violated.
 */
export function parseAnalysis(text: string): AnalysisResult {
  // Strip markdown code fences
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Extract the outermost JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Invalid analysis response');
  }
  cleaned = cleaned.slice(start, end + 1);

  // Fix trailing commas before ] or } (common LLM mistake)
  cleaned = stripTrailingCommas(cleaned);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Invalid analysis response');
  }

  return validateShape(parsed);
}

function stripTrailingCommas(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const current = value[i];

    if (escaped) {
      result += current;
      escaped = false;
      continue;
    }

    if (current === "\\") {
      result += current;
      escaped = true;
      continue;
    }

    if (current === "\"") {
      inString = !inString;
      result += current;
      continue;
    }

    if (!inString && current === ",") {
      let lookahead = i + 1;
      while (lookahead < value.length && /\s/.test(value[lookahead]!)) {
        lookahead += 1;
      }

      const nextChar = value[lookahead];
      if (nextChar === "}" || nextChar === "]") {
        continue;
      }
    }

    result += current;
  }

  return result;
}

function sanitizeModelText(value: string): string {
  return value.replace(INVISIBLE_TEXT_RE, "").trim();
}

function isNonEmptyString(v: unknown, maxLen?: number): v is string {
  const normalized = typeof v === "string" ? sanitizeModelText(v) : "";
  return (
    typeof v === 'string' &&
    normalized.length > 0 &&
    (maxLen === undefined || normalized.length <= maxLen)
  );
}

function validateHowItem(item: unknown, index: number): HowItem {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid analysis response');
  }
  const obj = item as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.title, 120) ||
    !isNonEmptyString(obj.description, 500) ||
    !isNonEmptyString(obj.uniqueness, 400)
  ) {
    throw new Error(`Invalid analysis response: how[${index}] missing fields`);
  }
  return {
    title: sanitizeModelText(obj.title),
    description: sanitizeModelText(obj.description),
    uniqueness: sanitizeModelText(obj.uniqueness),
  };
}

function validateWhatItem(item: unknown, index: number): WhatItem {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid analysis response');
  }
  const obj = item as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.title, 120) ||
    !isNonEmptyString(obj.description, 500) ||
    !isNonEmptyString(obj.why_connection, 400)
  ) {
    throw new Error(`Invalid analysis response: what[${index}] missing fields`);
  }
  return {
    title: sanitizeModelText(obj.title),
    description: sanitizeModelText(obj.description),
    why_connection: sanitizeModelText(obj.why_connection),
  };
}

function validateShape(data: unknown): AnalysisResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid analysis response');
  }
  const obj = data as Record<string, unknown>;

  // Validate why
  if (!obj.why || typeof obj.why !== 'object') {
    throw new Error('Invalid analysis response');
  }
  const why = obj.why as Record<string, unknown>;
  if (!isNonEmptyString(why.statement, 600) || !isNonEmptyString(why.depth_note, 400)) {
    throw new Error('Invalid analysis response');
  }

  // Validate how — exactly 4 items
  if (!Array.isArray(obj.how) || obj.how.length !== 4) {
    throw new Error('Invalid analysis response');
  }
  const how: HowItem[] = obj.how.map((item, i) => validateHowItem(item, i));

  // Validate what — exactly 3 items
  if (!Array.isArray(obj.what) || obj.what.length !== 3) {
    throw new Error('Invalid analysis response');
  }
  const what: WhatItem[] = obj.what.map((item, i) => validateWhatItem(item, i));

  // Validate positioning_note
  if (!isNonEmptyString(obj.positioning_note, 500)) {
    throw new Error('Invalid analysis response');
  }

  const allowed = new Set(["why", "how", "what", "positioning_note"]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error("Invalid analysis response");
    }
  }

  return {
    why: {
      statement: sanitizeModelText(why.statement),
      depth_note: sanitizeModelText(why.depth_note),
    },
    how,
    what,
    positioning_note: sanitizeModelText(obj.positioning_note),
  };
}
