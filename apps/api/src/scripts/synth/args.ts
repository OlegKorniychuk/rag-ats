import { parseArgs } from 'node:util';

/**
 * Pulls the global `--dir <path>` / `--dir=<path>` out of a stage's argv so
 * each stage can keep a strict parser for its own flags.
 */
export function extractDir(argv: string[]): { dir?: string; args: string[] } {
  const { values, tokens } = parseArgs({
    args: argv,
    options: { dir: { type: 'string' } },
    strict: false,
    tokens: true,
  });
  const drop = new Set<number>();
  for (const t of tokens) {
    if (t.kind === 'option' && t.name === 'dir') {
      drop.add(t.index);
      if (t.inlineValue === false) drop.add(t.index + 1);
    }
  }
  return {
    dir: typeof values.dir === 'string' ? values.dir : undefined,
    args: argv.filter((_, i) => !drop.has(i)),
  };
}
