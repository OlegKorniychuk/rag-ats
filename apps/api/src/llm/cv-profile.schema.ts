import { z } from 'zod';

export const CV_PROFILE_SCHEMA_NAME = 'cv_profile';

export const cvProfileSchema = z.object({
  skills: z
    .array(z.string())
    .describe(
      'Technologies, tools, frameworks and languages explicitly mentioned in the CV',
    ),
  experience: z
    .string()
    .describe(
      'Concise prose summary of work roles, companies and durations as stated in the CV',
    ),
  projects: z
    .array(z.string())
    .describe('One short line per notable project mentioned in the CV'),
  summary: z
    .string()
    .describe('A 2-3 sentence professional summary of the candidate'),
});

export type ParsedProfile = z.infer<typeof cvProfileSchema>;
