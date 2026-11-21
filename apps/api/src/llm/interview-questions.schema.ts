import { z } from 'zod';

export const INTERVIEW_QUESTIONS_SCHEMA_NAME = 'interview_questions';

// No min/max on the array: an answer with too few or too many questions would
// make the SDK's strict Zod parse throw, losing the whole response. The
// resolver checks the count instead.
export const interviewQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z
          .string()
          .describe('The question as the recruiter would ask it, in English'),
        basis: z
          .enum(['fact', 'gap'])
          .describe(
            '"fact": probes something the cited units state; "gap": probes a criterion scored below 50',
          ),
        criterionId: z
          .string()
          .describe('The id of the criterion the question checks, e.g. "c1"'),
        purpose: z
          .string()
          .describe('One sentence: what the answer will tell the recruiter'),
        evidence: z
          .array(z.string())
          .describe(
            'IDs of the units the question is about (e.g. "S14", "G3"): 1-3 for a fact; for a gap, empty or one unit with a concrete contrary fact',
          ),
      }),
    )
    .describe('6 to 8 questions, must-have criteria first'),
});

export type InterviewQuestionsOutput = z.infer<typeof interviewQuestionsSchema>;
