import { z } from "zod";

const score = z.number().int().min(1).max(5);

// Structured output of the critique node. Drives the refine decision and the
// score shown in the UI.
export const critiqueSchema = z.object({
  scores: z.object({
    specificity: score,
    nongeneric: score,
    fidelity: score,
    actionability: score,
  }),
  overall: z.number().min(1).max(5),
  weaknesses: z.array(z.string()),
  pass: z.boolean(),
});

export type Critique = z.infer<typeof critiqueSchema>;
