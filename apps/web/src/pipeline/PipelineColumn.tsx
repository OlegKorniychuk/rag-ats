import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { Chip, Paper, Stack, Typography } from '@mui/material';
import { useDroppable } from '@dnd-kit/core';
import { ApplicationCard } from './ApplicationCard';
import type { Stage } from './board';

interface PipelineColumnProps {
  stage: Stage;
  applications: readonly ApplicationWithCandidateResponse[];
}

export function PipelineColumn({ stage, applications }: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      role="region"
      aria-label={stage.label}
      sx={{
        flex: '1 1 0',
        minWidth: 0,
        p: 1.5,
        minHeight: 200,
        bgcolor: isOver ? 'action.selected' : 'grey.50',
        borderColor: isOver ? 'primary.main' : 'divider',
        borderWidth: isOver ? 2 : 1,
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
      >
        <Typography variant="subtitle2">{stage.label}</Typography>
        <Chip size="small" label={applications.length} />
      </Stack>
      <Stack spacing={1}>
        {applications.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No applicants
          </Typography>
        )}
        {applications.map((application) => (
          <ApplicationCard key={application.id} application={application} />
        ))}
      </Stack>
    </Paper>
  );
}
