import { parseArgs } from 'node:util';
import { UsageError } from '../shared/cli.js';

export const DEFAULT_CITATIONS_FROM = 'baseline-units';
export const DEFAULT_EVIDENCE_MAX_USD = 0.05;

export const EVIDENCE_EVAL_USAGE = [
  'Usage: evidence-eval [options]',
  '  Evidence recall@k of the index in DATABASE_URL (embedding model from',
  '  OPENAI_EMBEDDING_MODEL), with the full_text citations of a baseline run',
  '  as silver labels. Embeds the criterion texts only; writes nothing to the DB.',
  '  --label <name>            run name (docs/eval/rag-params/<name>.{json,md}); required unless --dry-run',
  `  --citations-from <label>  baseline run whose scores.jsonl holds the citations (default ${DEFAULT_CITATIONS_FROM})`,
  `  --max-usd <n>             refuse to run when the embedding estimate exceeds n (default ${DEFAULT_EVIDENCE_MAX_USD})`,
  '  --dry-run                 print the counts and the cost estimate, no LLM calls, nothing written',
].join('\n');

export interface EvidenceEvalArgs {
  label: string | null;
  citationsFrom: string;
  dryRun: boolean;
  maxUsd: number;
}

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const isName = (value: string): boolean =>
  NAME_PATTERN.test(value) && !/^\.+$/.test(value);

/** Parses the CLI flags; a bad or missing flag throws `UsageError`. */
export function parseEvidenceEvalArgs(argv: string[]): EvidenceEvalArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        'citations-from': { type: 'string' },
        'max-usd': { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const dryRun = values['dry-run'] === true;
  const label = (values.label as string | undefined) ?? null;
  if (label === null && !dryRun) {
    throw new UsageError('--label is required unless --dry-run');
  }
  if (label !== null && !isName(label)) {
    throw new UsageError(
      '--label may only contain letters, digits, ., _ and -',
    );
  }

  const citationsFrom =
    (values['citations-from'] as string | undefined) ?? DEFAULT_CITATIONS_FROM;
  if (!isName(citationsFrom)) {
    throw new UsageError(
      '--citations-from may only contain letters, digits, ., _ and -',
    );
  }

  const rawUsd = values['max-usd'] as string | undefined;
  let maxUsd = DEFAULT_EVIDENCE_MAX_USD;
  if (rawUsd !== undefined) {
    maxUsd = Number(rawUsd);
    if (rawUsd.trim() === '' || !Number.isFinite(maxUsd) || maxUsd <= 0) {
      throw new UsageError('--max-usd must be a positive number');
    }
  }

  return { label, citationsFrom, dryRun, maxUsd };
}
