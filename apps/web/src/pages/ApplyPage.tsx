import { useState } from 'react';
import { ApiError } from '../api/client';
import { getPublicVacancy } from '../api/apply';
import { ApplicationForm } from '../apply/ApplicationForm';
import { PageLoader } from '../components/PageLoader';
import { Alert, Box, Container, Paper, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';

export function ApplyPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['apply', token],
    queryFn: () => getPublicVacancy(token),
  });

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', mb: 2 }}
      >
        RAG-ATS
      </Typography>

      <Paper sx={{ p: 4 }}>
        {isPending && <PageLoader />}

        {isError &&
          (error instanceof ApiError && error.status === 404 ? (
            <Alert severity="warning">
              This application link is invalid or has expired
            </Alert>
          ) : (
            <Alert severity="error">
              Could not load this vacancy: {error.message}
            </Alert>
          ))}

        {!isPending && !isError && data && (
          <Box>
            <Typography variant="h4">{data.title}</Typography>
            <Typography variant="h6" sx={{ mt: 3 }}>
              Requirements
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>
              {data.requirements}
            </Typography>

            {data.status === 'closed' && (
              <Alert severity="info" sx={{ mt: 3 }}>
                This vacancy is no longer accepting applications
              </Alert>
            )}

            {data.status === 'open' &&
              (submittedName ? (
                <Alert severity="success" sx={{ mt: 3 }}>
                  Application submitted — thanks, {submittedName}!
                </Alert>
              ) : (
                <Box sx={{ mt: 3 }}>
                  <ApplicationForm
                    token={token}
                    onSubmitted={setSubmittedName}
                    onClosed={() =>
                      queryClient.invalidateQueries({
                        queryKey: ['apply', token],
                      })
                    }
                  />
                </Box>
              ))}
          </Box>
        )}
      </Paper>
    </Container>
  );
}
