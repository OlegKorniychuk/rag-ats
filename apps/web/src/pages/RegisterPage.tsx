import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  Link as MuiLink,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router';
import { getMe, login, register as registerRequest } from '../api/auth';
import { ApiError } from '../api/client';
import { registerSchema, type RegisterFormValues } from '../auth/schemas';
import { useSessionStore } from '../auth/sessionStore';

export function RegisterPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [accountCreated, setAccountCreated] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setAccountCreated(false);
    try {
      await registerRequest({ email: values.email, password: values.password });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('email', { message: 'Email already registered' });
      } else if (error instanceof ApiError) {
        setFormError(error.messages.join(', '));
      } else {
        setFormError('Could not reach the server');
      }
      return;
    }

    try {
      await login({ email: values.email, password: values.password });
      const user = await getMe();
      useSessionStore.getState().setUser(user);
    } catch {
      setAccountCreated(true);
    }
  });

  return (
    <Container
      maxWidth="xs"
      sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center' }}
    >
      <Card sx={{ width: '100%', p: 4 }}>
        <Box component="form" noValidate onSubmit={onSubmit}>
          <Stack spacing={2}>
            <Typography variant="h4">Register</Typography>
            {formError && <Alert severity="error">{formError}</Alert>}
            {accountCreated && (
              <Alert severity="info">
                Account created — please log in.{' '}
                <MuiLink component={RouterLink} to="/login">
                  Log in
                </MuiLink>
              </Alert>
            )}
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              error={!!errors.email}
              helperText={errors.email?.message}
              {...register('email')}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              error={!!errors.password}
              helperText={errors.password?.message}
              {...register('password')}
            />
            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
            <MuiLink component={RouterLink} to="/login">
              Already have an account? Log in
            </MuiLink>
          </Stack>
        </Box>
      </Card>
    </Container>
  );
}
