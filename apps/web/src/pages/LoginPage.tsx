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
import { getMe, login } from '../api/auth';
import { ApiError } from '../api/client';
import { loginSchema, type LoginFormValues } from '../auth/schemas';
import { useSessionStore } from '../auth/sessionStore';

export function LoginPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      const user = await getMe();
      useSessionStore.getState().setUser(user);
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(
          error.status === 401
            ? 'Invalid email or password'
            : error.messages.join(', '),
        );
      } else {
        setFormError('Could not reach the server');
      }
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
            <Typography variant="h4">Log in</Typography>
            {formError && <Alert severity="error">{formError}</Alert>}
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
              autoComplete="current-password"
              error={!!errors.password}
              helperText={errors.password?.message}
              {...register('password')}
            />
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              {isSubmitting ? 'Logging in…' : 'Log in'}
            </Button>
            <MuiLink component={RouterLink} to="/register">
              Create an account
            </MuiLink>
          </Stack>
        </Box>
      </Card>
    </Container>
  );
}
