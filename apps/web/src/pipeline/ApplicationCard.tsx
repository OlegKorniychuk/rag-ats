import type { KeyboardEvent } from 'react';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useDraggable } from '@dnd-kit/core';
import { useNavigate } from 'react-router';

const MAX_VISIBLE_SKILLS = 3;

interface ApplicationCardProps {
  application: ApplicationWithCandidateResponse;
}

function CardBody({ application }: ApplicationCardProps) {
  const { skills } = application.candidate;
  const visibleSkills = skills.slice(0, MAX_VISIBLE_SKILLS);
  const extraCount = skills.length - visibleSkills.length;

  return (
    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="subtitle2">{application.candidate.name}</Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {application.candidate.email}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {visibleSkills.map((skill) => (
          <Chip key={skill} label={skill} size="small" />
        ))}
        {extraCount > 0 && (
          <Chip label={`+${extraCount}`} size="small" variant="outlined" />
        )}
      </Stack>
    </CardContent>
  );
}

// Rendered inside DragOverlay: a plain visual clone, not a draggable/droppable node.
export function ApplicationCardOverlay({ application }: ApplicationCardProps) {
  return (
    <Card variant="outlined" sx={{ boxShadow: 6 }}>
      <CardBody application={application} />
    </Card>
  );
}

export function ApplicationCard({ application }: ApplicationCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: application.id,
  });

  const goToCandidate = () =>
    navigate(`/candidates/${application.candidate.id}`);

  // Space starts/ends a keyboard drag (see PipelineBoard's keyboardCodes); Enter navigates.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.key === 'Enter') {
      event.preventDefault();
      goToCandidate();
    }
  };

  return (
    <Card
      ref={setNodeRef}
      variant="outlined"
      onClick={goToCandidate}
      sx={{
        cursor: 'pointer',
        opacity: isDragging ? 0.4 : 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
    >
      <CardBody application={application} />
    </Card>
  );
}
