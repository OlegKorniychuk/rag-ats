import { z } from 'zod';

export const CV_PROFILE_SCHEMA_NAME = 'cv_profile';

export const cvProfileSchema = z.object({
  skills: z
    .array(z.string())
    .describe(
      'Technologies, languages, frameworks, tools and technical methods; never job titles or soft skills',
    ),
  experience: z
    .string()
    .describe(
      'One line per role, newest first: "Title — Company (start – end): 1–2 key achievements with their metrics"',
    ),
  projects: z
    .array(z.string())
    .describe(
      'One line per named project: "Name — what it is"; unnamed duties are not projects',
    ),
  summary: z
    .string()
    .describe('A 2-3 sentence professional summary of the candidate'),
});

export type ParsedProfile = z.infer<typeof cvProfileSchema>;
