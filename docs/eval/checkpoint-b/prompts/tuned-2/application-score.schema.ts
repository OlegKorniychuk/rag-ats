import { z } from 'zod';

export const APPLICATION_SCORE_SCHEMA_NAME = 'application_score';

// No min/max on `score`: a model answer outside 0-100 would make the SDK's
// strict Zod parse throw, losing the whole response. The scorer clamps instead.
export const applicationScoreSchema = z.object({
  criteria: z
    .array(
      z.object({
        criterionId: z
          .string()
          .describe('The id of the criterion being judged, e.g. "c1"'),
        score: z
          .number()
          .int()
          .describe(
            'Integer 0-100: how well the evidence shows the candidate meets this criterion',
          ),
        reasoning: z
          .string()
          .describe(
            'One or two sentences explaining the score from the evidence',
          ),
        quotes: z
          .array(
            z.object({
              source: z
                .enum(['cv', 'github'])
                .describe('Where the quote was copied from'),
              text: z
                .string()
                .describe(
                  'An exact, verbatim excerpt (2-300 characters) copied from that source',
                ),
            }),
          )
          .describe(
            '0-3 verbatim quotes that are evidence for this criterion; empty for a score of 0 when the CV is silent about it',
          ),
      }),
    )
    .describe('Exactly one entry per listed criterion id'),
  rationale: z
    .string()
    .describe('2-3 sentences summarising the candidate fit for the vacancy'),
});

export type ApplicationScoreOutput = z.infer<typeof applicationScoreSchema>;
