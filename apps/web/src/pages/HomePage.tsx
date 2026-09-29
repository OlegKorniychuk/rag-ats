import {
  Alert,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/health';

export function HomePage() {
  const { isPending, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: false,
  });

  return (
    <Container>
      <Typography variant="h1">RAG-ATS</Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
        {isPending && <CircularProgress size={16} />}
        {isPending && <Typography>Checking API…</Typography>}
      </Stack>
      {isError && (
        <Alert severity="error">API unreachable: {error.message}</Alert>
      )}
      {!isPending && !isError && <Alert severity="success">API: ok</Alert>}
    </Container>
  );
}
