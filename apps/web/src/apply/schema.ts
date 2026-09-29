import { z } from 'zod';
import type { SubmitApplicationRequest } from '@rag-ats/shared';

/** The raw, unparsed shape of the application form's fields. */
interface ApplicationFormInput {
  name: string;
  email: string;
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
  githubUrl: string;
  portfolioUrl: string;
}

const requiredText = (message: string) => z.string().trim().min(1, message);

const nonEmptyStringArray = z.array(z.string().trim().min(1));

const optionalUrl = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .pipe(z.url('Enter a valid URL').optional());

export const applicationSchema = z.object({
  name: requiredText('Name is required'),
  email: z.string().trim().pipe(z.email('Enter a valid email')),
  skills: nonEmptyStringArray.min(1, 'Add at least one skill'),
  experience: requiredText('Experience is required'),
  projects: nonEmptyStringArray,
  summary: requiredText('Summary is required'),
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
}) satisfies z.ZodType<SubmitApplicationRequest, ApplicationFormInput>;

export type ApplicationFormValues = z.input<typeof applicationSchema>;
export type ApplicationFormOutput = z.output<typeof applicationSchema>;
