import { Alert } from '@mui/material';
import { errorMessage } from '../lib/errors';

interface QueryErrorAlertProps {
  error: unknown;
  what: string;
}

export function QueryErrorAlert({ error, what }: QueryErrorAlertProps) {
  return (
    <Alert severity="error">
      Could not load {what}: {errorMessage(error)}
    </Alert>
  );
}
