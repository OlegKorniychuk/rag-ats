import { useState } from 'react';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import type { CollisionDetection, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  defaultKeyboardCoordinateGetter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Box } from '@mui/material';
import { ApplicationCardOverlay } from './ApplicationCard';
import { groupByStage, STAGES } from './board';
import { createDragEndHandler } from './dragEnd';
import { PipelineColumn } from './PipelineColumn';
import { useUpdateApplicationStage } from './queries';

// Space starts/ends a keyboard drag; Enter is left free for ApplicationCard's navigation.
const keyboardCodes = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space],
};

// keyboard drags have no pointer coordinates, so fall back to the dragged card's rect
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0
    ? pointerCollisions
    : rectIntersection(args);
};

interface PipelineBoardProps {
  vacancyId: string;
  applications: readonly ApplicationWithCandidateResponse[];
  onError: (message: string) => void;
}

export function PipelineBoard({
  vacancyId,
  applications,
  onError,
}: PipelineBoardProps) {
  const updateStage = useUpdateApplicationStage(vacancyId);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes,
      coordinateGetter: defaultKeyboardCoordinateGetter,
    }),
  );

  const grouped = groupByStage(applications);
  const activeApplication = applications.find(
    (application) => application.id === activeId,
  );
  const handleDragEnd = createDragEndHandler(
    applications,
    updateStage,
    onError,
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(event: DragStartEvent) =>
        setActiveId(String(event.active.id))
      }
      onDragEnd={(event) => {
        handleDragEnd(event);
        setActiveId(null);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <Box sx={{ display: 'flex', gap: 2 }}>
        {STAGES.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stage={stage}
            applications={grouped[stage.id]}
          />
        ))}
      </Box>
      <DragOverlay>
        {activeApplication ? (
          <ApplicationCardOverlay application={activeApplication} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
