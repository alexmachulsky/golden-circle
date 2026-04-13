import type { AnalysisResult, HowItem, WhatItem } from '@/types';

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
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Invalid analysis response');
  }

  return validateShape(parsed);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateHowItem(item: unknown, index: number): HowItem {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid analysis response');
  }
  const obj = item as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.title) ||
    !isNonEmptyString(obj.description) ||
    !isNonEmptyString(obj.uniqueness)
  ) {
    throw new Error(`Invalid analysis response: how[${index}] missing fields`);
  }
  return { title: obj.title, description: obj.description, uniqueness: obj.uniqueness };
}

function validateWhatItem(item: unknown, index: number): WhatItem {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid analysis response');
  }
  const obj = item as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.title) ||
    !isNonEmptyString(obj.description) ||
    !isNonEmptyString(obj.why_connection)
  ) {
    throw new Error(`Invalid analysis response: what[${index}] missing fields`);
  }
  return { title: obj.title, description: obj.description, why_connection: obj.why_connection };
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
  if (!isNonEmptyString(why.statement) || !isNonEmptyString(why.depth_note)) {
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
  if (!isNonEmptyString(obj.positioning_note)) {
    throw new Error('Invalid analysis response');
  }

  return {
    why: { statement: why.statement, depth_note: why.depth_note },
    how,
    what,
    positioning_note: obj.positioning_note,
  };
}
