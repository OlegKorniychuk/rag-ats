import { z } from 'zod';

export const VACANCY_CRITERIA_SCHEMA_NAME = 'vacancy_criteria';

export const vacancyCriteriaSchema = z.object({
  criteria: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            'One short, self-contained requirement (a single skill, experience or qualification) that can be assessed on its own',
          ),
        importance: z
          .enum(['must', 'nice'])
          .describe(
            '"nice" only for items the vacancy explicitly marks as nice to have, bonus or a plus; otherwise "must"',
          ),
      }),
    )
    .describe('3 to 10 criteria derived from the vacancy'),
});

export type VacancyCriteriaOutput = z.infer<typeof vacancyCriteriaSchema>;
