import { Chip } from '@mui/material';
import type { CriterionImportance } from '@rag-ats/shared';

const IMPORTANCE_LABELS = {
  must: 'Must',
  nice: 'Nice to have',
} satisfies Record<CriterionImportance, string>;

export function ImportanceChip({
  importance,
}: {
  importance: CriterionImportance;
}) {
  return (
    <Chip
      size="small"
      label={IMPORTANCE_LABELS[importance]}
      color={importance === 'must' ? 'primary' : 'default'}
      variant={importance === 'must' ? 'filled' : 'outlined'}
    />
  );
}
