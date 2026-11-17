/**
 * Tag mention matcher: which taxonomy tags does a text mention?
 *
 * Rules:
 * - Aliases match on word boundaries: `Java` is not found in `JavaScript`, but
 *   `C++`, `C#`, `Node.js`, `CI/CD` and `.NET` style aliases work (the boundary
 *   is "no letter, digit or underscore next to the alias").
 * - Matching is case-insensitive, except for
 *     - aliases that are all-caps acronyms (`REST`, `SQL`, `AWS`, `LLM`): a
 *       plural `s` is accepted (`LLMs`), but `rest` is not `REST`;
 *     - the alias `Node` (the word "node" is common in prose);
 *     - every alias of an `ambiguous` taxonomy tag.
 * - Aliases of 5+ letters also match a plural `s` (`REST APIs`, `pipelines`).
 * - Overlapping matches keep the longest (`React Native` is not `React`,
 *   `GitHub Actions` is not `GitHub`, `C++` is not `C`).
 * - URLs are ignored.
 * - Experience tags (`kind: 'experience'`, no aliases) are never matched.
 *
 * Tech context. A bare capitalised word of an ambiguous tag (`Go`, `R`, `C`,
 * `Swift`, `Rust`, `Spring`, `Express`, `React`, ...) can be an ordinary word,
 * so it only counts when one of these holds:
 *   1. it is the whole text (a skills-section item);
 *   2. it is a whole list item (the line is split on `, ; / | : ( )`, ` & `,
 *      ` + `, `and`, `or`) and an adjacent short item (up to 4 words) holds
 *      another alias: `Python, Django, Go`, `Go and Rust`;
 *   3. it follows a tech phrase: `using`, `with`, `via`, `written in`,
 *      `built in|with|on`, `implemented in`, `migrated to`, `powered by`,
 *      `based on`, ... (and Ukrainian `на`, `мовою`, `використовуючи`, ...);
 *   4. it is followed by a tech noun: `Go services`, `Spring application`,
 *      `React components`, `Agile team`;
 *   5. it sits on a labelled line: `Tech stack: Go`, `Skills: R`.
 * Aliases that cannot be a plain word (`Spring Boot`, `Express.js`, `PySpark`,
 * `React Native`) need no context but are still case-sensitive.
 * False negatives are acceptable ("R" in an odd sentence); false positives
 * ("Go to market", "R&D", "Plan C", "In Spring 2023") are not.
 */
import type { Taxonomy, TaxonomyTag } from './types.js';

interface CompiledAlias {
  tag: string;
  alias: string;
  regex: RegExp;
  /** A common word when capitalised: only counts in a tech context. */
  needsContext: boolean;
}

interface Match {
  tag: string;
  start: number;
  end: number;
  needsContext: boolean;
}

const ACRONYM = /^[A-Z0-9]{2,6}$/;
const PLAIN_WORD = /^[A-Z][a-z]*$/;
const CASE_SENSITIVE_ALIASES = new Set(['Node']);

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function compileAlias(tag: TaxonomyTag, alias: string): CompiledAlias {
  const acronym = ACRONYM.test(alias);
  const ambiguous = tag.ambiguous === true;
  const caseSensitive =
    ambiguous || acronym || CASE_SENSITIVE_ALIASES.has(alias);
  const needsContext = ambiguous && PLAIN_WORD.test(alias);

  const endsWord = /[A-Za-z0-9]$/.test(alias);
  let source = `(?<![A-Za-z0-9_])${escapeRegExp(alias)}`;
  const plural =
    acronym ||
    (!needsContext &&
      !caseSensitive &&
      alias.length >= 5 &&
      /[A-Za-z]$/.test(alias));
  if (plural) source += 's?';
  source += endsWord ? '(?![A-Za-z0-9_])' : '(?![A-Za-z_+#])';
  // "Go-to-market", "Swift-like": a hyphen glues a plain word to its neighbour.
  if (needsContext) source = `(?<![A-Za-z0-9]-)${source}(?!-[A-Za-z0-9])`;
  return {
    tag: tag.tag,
    alias,
    regex: new RegExp(source, caseSensitive ? 'g' : 'gi'),
    needsContext,
  };
}

const compiledCache = new WeakMap<Taxonomy, CompiledAlias[]>();

function compiled(taxonomy: Taxonomy): CompiledAlias[] {
  let list = compiledCache.get(taxonomy);
  if (!list) {
    list = taxonomy.tags.flatMap((tag) =>
      tag.kind === 'experience'
        ? []
        : tag.aliases.map((alias) => compileAlias(tag, alias)),
    );
    compiledCache.set(taxonomy, list);
  }
  return list;
}

const URL_PATTERN = /https?:\/\/\S+/g;

const CONJUNCTION = '(?:and|or|та|і|й|або)';
const NOT_LETTER_BEFORE = '(?<![\\p{L}\\p{N}])';

/** Splits a line into list items. `R&D` and `CI/CD`-style aliases stay whole. */
const ITEM_SEPARATOR = new RegExp(
  `\\s*(?:[,;/|•·:()\\[\\]]|\\s[&+]\\s|(?<![\\p{L}\\p{N}])${CONJUNCTION}(?![\\p{L}\\p{N}]))\\s*`,
  'giu',
);
/** A list item longer than this is prose, not a skills-list entry. */
const MAX_ITEM_WORDS = 4;

const TECH_PHRASE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:using|with|via|written in|written with|built in|built on|built with|implemented in|implemented with|developed in|developed with|coded in|programmed in|programming in|rewritten in|rewrote in|migrated to|ported to|powered by|based on|на|мовою|використовуючи|використанням|за допомогою)\\s+$`,
  'iu',
);
const TECH_NOUN = new RegExp(
  `^\\s+(?:services?|microservices?|backends?|code|codebase|modules?|programs?|librar(?:y|ies)|developers?|engineers?|projects?|APIs?|CLIs?|tooling|scripts?|apps?|applications?|components?|servers?|jobs?|pipelines?|clusters?|charts?|tests?|test suites?|suites?|scenarios?|warehouse|packages?|crates?|workers?|runtime|stack|framework|ecosystem|workloads|teams?|methodology|methodologies|environments?|ceremonies|practices|process|workflow|boards?|sprints?|master)(?![\\p{L}\\p{N}])`,
  'iu',
);
const LABEL_LINE =
  /\b(?:tech(?:nical)? stack|technologies|tech|stack|tools|languages|skills)\s*:/i;

interface Item {
  start: number;
  end: number;
}

/**
 * Rule 2: the match is a whole list item (`Python, Go, Docker`) and an
 * adjacent short item of the same line holds another alias.
 */
function isListItemNextToAlias(text: string, m: Match, all: Match[]): boolean {
  const lineStart = text.lastIndexOf('\n', m.start - 1) + 1;
  const nl = text.indexOf('\n', m.end);
  const lineEnd = nl === -1 ? text.length : nl;
  const items: Item[] = [];
  let from = lineStart;
  for (const sep of text.slice(lineStart, lineEnd).matchAll(ITEM_SEPARATOR)) {
    const at = lineStart + sep.index;
    items.push({ start: from, end: at });
    from = at + sep[0].length;
  }
  items.push({ start: from, end: lineEnd });

  const own = items.findIndex((i) => m.start >= i.start && m.end <= i.end);
  if (own === -1) return false;
  const rest = text
    .slice(items[own].start, items[own].end)
    .replace(/^[\s"'`*-]+|[\s"'`*.!?-]+$/g, '');
  if (rest !== text.slice(m.start, m.end)) return false;

  const inItem = (item: Item): Match[] =>
    all.filter((o) => o !== m && o.start < item.end && o.end > item.start);
  const isShort = (item: Item): boolean =>
    text.slice(item.start, item.end).trim().split(/\s+/).length <=
    MAX_ITEM_WORDS;
  for (const step of [-1, 1]) {
    for (let j = own + step; j >= 0 && j < items.length; j += step) {
      const item = items[j];
      const found = inItem(item);
      // The nearest item may start a sentence ("built with RabbitMQ, React"):
      // its alias only has to touch the separator.
      const touches = (o: Match): boolean =>
        step === -1
          ? text.slice(o.end, item.end).trim() === ''
          : text.slice(item.start, o.start).trim() === '';
      if (j === own + step && found.some(touches)) return true;
      if (!isShort(item)) break;
      if (found.length > 0) return true;
    }
  }
  return false;
}

function inTechContext(text: string, m: Match, all: Match[]): boolean {
  const before = text.slice(0, m.start);
  const after = text.slice(m.end);

  if (before.trim() === '' && /^[\s.;,]*$/.test(after)) return true;
  if (TECH_PHRASE.test(before)) return true;
  if (TECH_NOUN.test(after)) return true;
  if (LABEL_LINE.test(before.slice(before.lastIndexOf('\n') + 1))) return true;

  return isListItemNextToAlias(text, m, all);
}

function rawMatches(text: string, taxonomy: Taxonomy): Match[] {
  const found: Match[] = [];
  for (const c of compiled(taxonomy)) {
    c.regex.lastIndex = 0;
    for (const hit of text.matchAll(c.regex)) {
      found.push({
        tag: c.tag,
        start: hit.index,
        end: hit.index + hit[0].length,
        needsContext: c.needsContext,
      });
    }
  }
  // Longest first, then drop matches inside a longer one.
  found.sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: Match[] = [];
  for (const m of found) {
    const inside = kept.some((k) => m.start >= k.start && m.end <= k.end);
    if (!inside) kept.push(m);
  }
  return kept;
}

export interface FindTagsOptions {
  /**
   * Treat the whole text as tech context, so ambiguous aliases need no
   * context cue (still case-sensitive). For text that is about technology by
   * construction, such as a vacancy requirement.
   */
  assumeTechContext?: boolean;
}

/** Tags mentioned in `text`. */
export function findTags(
  text: string,
  taxonomy: Taxonomy,
  options: FindTagsOptions = {},
): Set<string> {
  const clean = text.replace(URL_PATTERN, (u) => ' '.repeat(u.length));
  const all = rawMatches(clean, taxonomy);
  const tags = new Set<string>();
  for (const m of all) {
    if (
      !m.needsContext ||
      options.assumeTechContext === true ||
      inTechContext(clean, m, all)
    ) {
      tags.add(m.tag);
    }
  }
  return tags;
}

export function mentions(
  text: string,
  tag: string,
  taxonomy: Taxonomy,
): boolean {
  return findTags(text, taxonomy).has(tag);
}

/** Tags mentioned in any of the texts. */
export function findTagsIn(
  texts: string[],
  taxonomy: Taxonomy,
  options: FindTagsOptions = {},
): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const tag of findTags(text, taxonomy, options)) out.add(tag);
  }
  return out;
}

const normalise = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9+#]/g, '');

/**
 * Tags a GitHub topic names. A topic is a standalone token (`go`, `node-js`,
 * `react-native`), so it matches an alias whole, ignoring case and punctuation;
 * otherwise it is matched as text with hyphens turned into spaces.
 */
export function findTagsInTopic(
  topic: string,
  taxonomy: Taxonomy,
): Set<string> {
  const out = findTags(topic.replace(/-/g, ' '), taxonomy);
  const key = normalise(topic);
  if (key === '') return out;
  for (const tag of taxonomy.tags) {
    if (tag.kind === 'experience') continue;
    if (tag.aliases.some((alias) => normalise(alias) === key)) {
      out.add(tag.tag);
    }
  }
  return out;
}
