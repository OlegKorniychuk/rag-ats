import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  FormHelperText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Controller, useForm } from 'react-hook-form';
import { submitApplication } from '../api/apply';
import { ApiError } from '../api/client';
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

// keeps the input focusable for keyboard users, unlike `hidden`
const visuallyHiddenInput = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

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
      githubUrl: '',
      portfolioUrl: '',
      cv: undefined,
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
        } else if (error.status === 413) {
          setFormError('CV must be 5 MB or smaller');
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
        <Controller
          name="cv"
          control={control}
          render={({ field }) => (
            <Box>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Button component="label" variant="outlined">
                  Upload CV (PDF)
                  <input
                    type="file"
                    accept="application/pdf"
                    style={visuallyHiddenInput}
                    aria-describedby={errors.cv ? 'cv-error' : undefined}
                    onChange={(event) =>
                      field.onChange(event.target.files?.[0])
                    }
                    onBlur={field.onBlur}
                  />
                </Button>
                <Typography color="text.secondary">
                  {field.value?.name ?? 'No file chosen'}
                </Typography>
              </Stack>
              {errors.cv && (
                <FormHelperText id="cv-error" error role="alert">
                  {errors.cv.message}
                </FormHelperText>
              )}
            </Box>
          )}
        />
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Submit application'}
        </Button>
      </Stack>
    </Box>
  );
}
