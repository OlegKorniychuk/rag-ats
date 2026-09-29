import { Link as RouterLink } from 'react-router';
import { Alert, Link, Stack } from '@mui/material';

interface NotFoundStateProps {
  title: string;
  backTo: string;
  backLabel: string;
}

export function NotFoundState({
  title,
  backTo,
  backLabel,
}: NotFoundStateProps) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Alert severity="warning">{title}</Alert>
      <Link component={RouterLink} to={backTo}>
        {backLabel}
      </Link>
    </Stack>
  );
}
