// Splits CV / GitHub text into numbered evidence units. The scorer cites a unit
// by ID instead of copying its text, so unit boundaries must be deterministic.

export const MAX_UNIT_CHARS = 300;
/** A line shorter than this is treated as a heading, a skill or a column fragment. */
export const WRAP_MIN_CHARS = 40;

export interface EvidenceUnit {
  id: string;
  source: 'cv' | 'github';
  text: string;
}

const MAX_BLOCK_CHARS = 4 * MAX_UNIT_CHARS;
const SENTENCE_END = /[.!?:;…]$/u;
const BULLET_START = /^\s*[•●○■□▪◦·►➢✓\-–*]\s/u;
const HYPHEN_WRAP = /\S-$/u;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u;

function joinsBlock(block: string[], line: string): boolean {
  const last = block[block.length - 1];
  if (last.length < WRAP_MIN_CHARS) return false;
  if (SENTENCE_END.test(last)) return false;
  if (line.length < WRAP_MIN_CHARS && !SENTENCE_END.test(line)) return false;
  if (BULLET_START.test(line)) return false;
  const merged = block.reduce((n, l) => n + l.length + 1, 0) + line.length;
  return merged <= MAX_BLOCK_CHARS;
}

function joinLines(lines: string[]): string {
  return lines.reduce((acc, line, i) =>
    i > 0 && HYPHEN_WRAP.test(lines[i - 1]) ? acc + line : `${acc} ${line}`,
  );
}

function toBlocks(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const blocks: string[][] = [];
  for (const line of lines) {
    const current = blocks[blocks.length - 1];
    if (current && joinsBlock(current, line)) current.push(line);
    else blocks.push([line]);
  }
  return blocks.map(joinLines);
}

/** Packs words into pieces of at most MAX_UNIT_CHARS; an over-long word is hard-cut. */
function capLength(sentence: string): string[] {
  if (sentence.length <= MAX_UNIT_CHARS) return [sentence];
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    if (current) pieces.push(current);
    current = '';
  };
  for (const word of sentence.split(' ')) {
    if (word.length > MAX_UNIT_CHARS) {
      flush();
      for (let i = 0; i < word.length; i += MAX_UNIT_CHARS) {
        pieces.push(word.slice(i, i + MAX_UNIT_CHARS));
      }
      continue;
    }
    if (current && current.length + 1 + word.length > MAX_UNIT_CHARS) flush();
    current = current ? `${current} ${word}` : word;
  }
  flush();
  return pieces;
}

/** The unit texts of `text`, in order. */
export function segmentText(text: string): string[] {
  return toBlocks(text)
    .flatMap((block) => block.split(SENTENCE_BREAK))
    .flatMap(capLength);
}

/**
 * Segments every line on its own, with no cross-line wrap-merge. For text whose
 * lines are single fields (the GitHub block: repo header, Description, README),
 * where the wrap rule would glue unrelated fields together.
 */
export function segmentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap(segmentText);
}

function numbered(
  texts: string[],
  source: EvidenceUnit['source'],
  prefix: string,
): EvidenceUnit[] {
  return texts.map((unitText, i) => ({
    id: `${prefix}${i + 1}`,
    source,
    text: unitText,
  }));
}

export function cvUnits(cvText: string): EvidenceUnit[] {
  return numbered(segmentText(cvText), 'cv', 'S');
}

/**
 * `githubBlock` is the exact `buildGithubBlock` output, tags included. Its lines
 * are never hard-wrapped (each is a whole header, field or README), so every
 * line is segmented on its own; the wrap-merge rule would glue a repo header
 * onto the `Description:` / `README:` line that follows it.
 */
export function githubUnits(githubBlock: string): EvidenceUnit[] {
  const content = githubBlock
    .replace(/^<github>\s*/, '')
    .replace(/\s*<\/github>$/, '');
  return numbered(segmentLines(content), 'github', 'G');
}
