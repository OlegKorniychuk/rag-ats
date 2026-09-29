import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { Controller, useForm } from 'react-hook-form';
import { submitApplication } from '../api/apply';
import { ApiError } from '../api/client';
import { ChipInput } from '../components/ChipInput';
import {
  applicationSchema,
  type ApplicationFormOutput,
  type ApplicationFormValues,
} from './schema';

interface ApplicationFormProps {
  token: string;
  onSubmitted: (name: string) => void;
  onClosed: () => void;
}

export function ApplicationForm({
  token,
  onSubmitted,
  onClosed,
}: ApplicationFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ApplicationFormValues, unknown, ApplicationFormOutput>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      name: '',
      email: '',
      skills: [],
      experience: '',
      projects: [],
      summary: '',
      githubUrl: '',
      portfolioUrl: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await submitApplication(token, values);
      onSubmitted(values.name);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409 && error.messages[0] === 'Vacancy is closed') {
          onClosed();
          return;
        }
        if (
          error.status === 409 &&
          error.messages[0] === 'Already applied to this vacancy'
        ) {
          setFormError("You've already applied to this vacancy");
        } else if (error.status === 404) {
          setFormError('This application link is invalid or has expired');
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('Could not reach the server');
      }
    }
  });

  return (
    <Box component="form" onSubmit={onSubmit} noValidate>
      <Stack spacing={2}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField
          label="Name"
          error={!!errors.name}
          helperText={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Email"
          type="email"
          error={!!errors.email}
          helperText={errors.email?.message}
          {...register('email')}
        />
        <Controller
          name="skills"
          control={control}
          render={({ field }) => (
            <ChipInput
              label="Skills"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={!!errors.skills}
              helperText={errors.skills?.message}
            />
          )}
        />
        <TextField
          label="Experience"
          multiline
          minRows={3}
          error={!!errors.experience}
          helperText={errors.experience?.message}
          {...register('experience')}
        />
        <Controller
          name="projects"
          control={control}
          render={({ field }) => (
            <ChipInput
              label="Projects"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              helperText="Optional — press Enter to add"
            />
          )}
        />
        <TextField
          label="Summary"
          multiline
          minRows={3}
          error={!!errors.summary}
          helperText={errors.summary?.message}
          {...register('summary')}
        />
        <TextField
          label="GitHub URL"
          error={!!errors.githubUrl}
          helperText={errors.githubUrl?.message}
          {...register('githubUrl')}
        />
        <TextField
          label="Portfolio URL"
          error={!!errors.portfolioUrl}
          helperText={errors.portfolioUrl?.message}
          {...register('portfolioUrl')}
        />
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Submit application'}
        </Button>
      </Stack>
    </Box>
  );
}
