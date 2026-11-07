import { useState } from 'react';
import { Box, Button, Chip, Typography } from '@mui/material';

const SOURCE_LABELS = {
  cv: 'CV',
  github: 'GitHub',
} satisfies Record<'cv' | 'github', string>;

export const CLAMP_MIN_CHARS = 300;
const CLAMP_LINES = 4;

interface QuoteBlockProps {
  quote: { source: 'cv' | 'github'; text: string };
  /** Collapse long text behind a "Show more" toggle. */
  clamp?: boolean;
}

export function QuoteBlock({ quote, clamp = false }: QuoteBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const clampable = clamp && quote.text.length > CLAMP_MIN_CHARS;
  const collapsed = clampable && !expanded;

  return (
    <Box
      component="blockquote"
      sx={{
        m: 0,
        pl: 1.5,
        py: 0.5,
        borderLeft: 3,
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Chip
        size="small"
        variant="outlined"
        label={SOURCE_LABELS[quote.source]}
        sx={{ mb: 0.5 }}
      />
      <Typography
        variant="body2"
        sx={{
          fontStyle: 'italic',
          // search snippets are verbatim CV lines: keep their line breaks
          whiteSpace: 'pre-line',
          ...(collapsed && {
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: CLAMP_LINES,
            overflow: 'hidden',
          }),
        }}
      >
        {quote.text}
      </Typography>
      {clampable && (
        <Button
          size="small"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </Box>
  );
}
