import { z } from 'zod';
import type { SubmitApplicationRequest } from '@rag-ats/shared';

/** The raw, unparsed shape of the application form's fields. */
interface ApplicationFormInput {
  name: string;
  email: string;
  githubUrl: string;
  portfolioUrl: string;
  cv: File | undefined;
}

export const CV_MAX_SIZE_BYTES = 5 * 1024 * 1024;

const requiredText = (message: string) => z.string().trim().min(1, message);

const optionalUrl = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .pipe(z.url('Enter a valid URL').optional());

export const applicationSchema = z.object({
  name: requiredText('Name is required'),
  email: z.string().trim().pipe(z.email('Enter a valid email')),
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  cv: z
    .instanceof(File, { error: 'Attach your CV as a PDF' })
    .refine((file) => file.type === 'application/pdf', 'CV must be a PDF')
    .refine(
      (file) => file.size <= CV_MAX_SIZE_BYTES,
      'CV must be 5 MB or smaller',
    ),
}) satisfies z.ZodType<
  SubmitApplicationRequest & { cv: File },
  ApplicationFormInput
>;

export type ApplicationFormValues = z.input<typeof applicationSchema>;
export type ApplicationFormOutput = z.output<typeof applicationSchema>;
