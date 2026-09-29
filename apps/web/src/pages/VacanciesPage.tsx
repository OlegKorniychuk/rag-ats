import { useState } from 'react';
import type { VacancyResponse } from '@rag-ats/shared';
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
import { VacancyFormDialog } from '../vacancies/VacancyFormDialog';
import { VacancyRow } from '../vacancies/VacancyRow';

interface DialogState {
  open: boolean;
  vacancy?: VacancyResponse;
  openCount: number;
}

export function VacanciesPage() {
  const { data, isLoading, isError, error } = useVacancies();
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    openCount: 0,
  });

  const openDialog = (vacancy?: VacancyResponse) =>
    setDialog((d) => ({ open: true, vacancy, openCount: d.openCount + 1 }));
  const openCreateDialog = () => openDialog();
  // keeps vacancy so the dialog doesn't flash to "New vacancy" while fading out
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const handleSaved = (message: string) => {
    closeDialog();
    setSnackbarMessage(message);
  };

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Typography variant="h4">Vacancies</Typography>
        <Button variant="contained" onClick={openCreateDialog}>
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
                  onEdit={openDialog}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <VacancyFormDialog
        key={dialog.openCount}
        open={dialog.open}
        vacancy={dialog.vacancy}
        onClose={closeDialog}
        onSaved={handleSaved}
      />

      <Snackbar
        open={snackbarMessage !== null}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        message={snackbarMessage}
      />
    </Stack>
  );
}
