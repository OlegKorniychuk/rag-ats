import { z } from 'zod';

export const VACANCY_CRITERIA_SCHEMA_NAME = 'vacancy_criteria';

export const vacancyCriteriaSchema = z.object({
  criteria: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            'One self-contained requirement as the vacancy states it, keeping its examples and alternatives inside it',
          ),
        importance: z
          .enum(['must', 'nice'])
          .describe(
            '"nice" only for items the vacancy explicitly marks as nice to have, bonus or a plus; otherwise "must"',
          ),
      }),
    )
    .describe('3 to 15 criteria, one per stated requirement'),
});

export type VacancyCriteriaOutput = z.infer<typeof vacancyCriteriaSchema>;
