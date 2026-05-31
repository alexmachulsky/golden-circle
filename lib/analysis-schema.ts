import { z } from "zod";

// Single source of truth for the analysis shape: AI SDK structured output,
// server validation, and the inferred type all derive from this. The 4-HOW /
// 3-WHAT invariant lives here. citations/confidence are optional and unused
// until P2 (grounding/RAG); declared now so the wire shape is stable.
export const citationSchema = z.object({
  claim: z.string(),
  source: z.string(),
  url: z.string().url().optional(),
});

export const analysisSchema = z.object({
  why: z.object({ statement: z.string(), depth_note: z.string() }),
  how: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        uniqueness: z.string(),
      }),
    )
    .length(4),
  what: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        why_connection: z.string(),
      }),
    )
    .length(3),
  positioning_note: z.string(),
  citations: z.array(citationSchema).optional(),
  confidence: z
    .object({ why: z.number(), how: z.number(), what: z.number() })
    .optional(),
});

export type Analysis = z.infer<typeof analysisSchema>;
