import { useState } from 'react';
import type { VacancyResponse } from '@rag-ats/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError } from '../api/client';
import { vacancySchema, type VacancyFormValues } from './schema';
import { useCreateVacancy, useUpdateVacancy } from './queries';
import { changesCriteria } from './rescore';

interface VacancyFormDialogProps {
  open: boolean;
  vacancy?: VacancyResponse;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function VacancyFormDialog({
  open,
  vacancy,
  onClose,
  onSaved,
}: VacancyFormDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <VacancyForm vacancy={vacancy} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

interface VacancyFormProps {
  vacancy?: VacancyResponse;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function VacancyForm({ vacancy, onClose, onSaved }: VacancyFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const createVacancy = useCreateVacancy();
  const updateVacancy = useUpdateVacancy();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<VacancyFormValues>({
    resolver: zodResolver(vacancySchema),
    defaultValues: {
      title: vacancy?.title ?? '',
      requirements: vacancy?.requirements ?? '',
    },
  });

  const [title, requirements] = useWatch({
    control,
    name: ['title', 'requirements'],
  });
  const criteriaChanged =
    !!vacancy && changesCriteria(vacancy, { title, requirements });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (vacancy) {
        await updateVacancy.mutateAsync({
          id: vacancy.id,
          body: { title: values.title, requirements: values.requirements },
        });
        onSaved(
          changesCriteria(vacancy, values) && vacancy.status === 'open'
            ? 'Vacancy updated · re-scoring applicants'
            : 'Vacancy updated',
        );
      } else {
        await createVacancy.mutateAsync(values);
        onSaved('Vacancy created');
      }
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Could not reach the server',
      );
    }
  });

  const submitLabel = vacancy
    ? isSubmitting
      ? 'Saving…'
      : 'Save'
    : isSubmitting
      ? 'Creating…'
      : 'Create';

  return (
    <Box component="form" onSubmit={onSubmit} noValidate>
      <DialogTitle>{vacancy ? 'Edit vacancy' : 'New vacancy'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField
            label="Title"
            error={!!errors.title}
            helperText={errors.title?.message}
            {...register('title')}
          />
          <TextField
            label="Requirements"
            multiline
            minRows={4}
            error={!!errors.requirements}
            helperText={errors.requirements?.message}
            {...register('requirements')}
          />
          {vacancy && criteriaChanged && (
            <Alert severity="info">
              {vacancy.status === 'open'
                ? 'Saving will re-score every applicant against the new requirements.'
                : "This vacancy is closed: applicants' scores will be marked outdated and re-scored when you reopen it."}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Box>
  );
}
