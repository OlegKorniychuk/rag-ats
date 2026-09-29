import { useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useVacancies } from '../vacancies/queries';
import { VacancyRow } from '../vacancies/VacancyRow';

export function VacanciesPage() {
  const { data, isLoading, isError, error } = useVacancies();
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Typography variant="h4">Vacancies</Typography>
        <Button variant="contained" disabled>
          New vacancy
        </Button>
      </Stack>

      {isLoading && <CircularProgress />}

      {isError && (
        <Alert severity="error">
          Could not load vacancies: {error.message}
        </Alert>
      )}

      {!isLoading && !isError && data?.length === 0 && (
        <Typography>No vacancies yet</Typography>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((vacancy) => (
                <VacancyRow
                  key={vacancy.id}
                  vacancy={vacancy}
                  onNotify={setSnackbarMessage}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Snackbar
        open={snackbarMessage !== null}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        message={snackbarMessage}
      />
    </Stack>
  );
}
