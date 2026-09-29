import { Link as RouterLink } from 'react-router';
import { Button, Container, Stack, Typography } from '@mui/material';

export function NotFoundPage() {
  return (
    <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
      <Stack spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h4">Page not found</Typography>
        <Typography color="text.secondary">
          The page you&apos;re looking for doesn&apos;t exist.
        </Typography>
        <Button component={RouterLink} to="/vacancies" variant="contained">
          Go to vacancies
        </Button>
      </Stack>
    </Container>
  );
}
