import { z } from 'zod';
import type { CreateVacancyRequest } from '@rag-ats/shared';

export const vacancySchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  requirements: z.string().trim().min(1, 'Requirements are required'),
}) satisfies z.ZodType<CreateVacancyRequest>;

export type VacancyFormValues = z.infer<typeof vacancySchema>;
