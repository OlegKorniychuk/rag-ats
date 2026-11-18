/**
 * G4 per scored pair: for the tags the rule meets only through GitHub
 * (`github_only` skills), did the scorer see them? Pure: computed from a job
 * record and the dataset, so the report can aggregate it.
 */
import { criteriaMentioningTag } from './g4.js';
import type { EvalDataset } from './preflight.js';
import { pairKey } from './sample.js';
import type { ScoreOkRecord } from './score-record.js';
import type { GroundTruthPair } from '../synth/types.js';

export interface G4TagResult {
  tag: string;
  /** Some scorer criterion mentions the tag (by alias). */
  mapped: boolean;
  /** Ids of the criteria that mention it. */
  criterionIds: string[];
  /** Some mapped criterion scored above 0. */
  credited: boolean;
  /** Some mapped criterion cites a `github` quote. */
  citedGithub: boolean;
}

/** What G4 reads of the dataset (no database state), so a report can be rebuilt offline. */
export type G4Dataset = Pick<
  EvalDataset,
  'taxonomy' | 'personas' | 'groundTruth'
>;

const truthIndex = new WeakMap<G4Dataset, Map<string, GroundTruthPair>>();

function truthOf(
  dataset: G4Dataset,
  pair: { vacancyId: string; personaId: string },
): GroundTruthPair | undefined {
  let index = truthIndex.get(dataset);
  if (!index) {
    index = new Map(dataset.groundTruth.pairs.map((p) => [pairKey(p), p]));
    truthIndex.set(dataset, index);
  }
  return index.get(pairKey(pair));
}

/**
 * Tags the rule counts as met for the pair whose persona skill is
 * `github_only`, sorted and deduplicated. Empty for a pair that is not in the
 * ground truth, an unknown persona, or one with no such tag.
 */
export function githubOnlyMetTags(
  dataset: G4Dataset,
  pair: { vacancyId: string; personaId: string },
): string[] {
  const truth = truthOf(dataset, pair);
  const persona = dataset.personas.find((p) => p.id === pair.personaId);
  if (!truth || !persona) return [];
  const githubOnly = new Set(
    persona.skills
      .filter((s) => s.evidence === 'github_only')
      .map((s) => s.tag),
  );
  const tags = new Set<string>();
  for (const req of truth.requirements) {
    if (req.status === 'met' && req.tag && githubOnly.has(req.tag)) {
      tags.add(req.tag);
    }
  }
  return [...tags].sort();
}

/**
 * One entry per github-only tag of the record's pair; empty when the pair has
 * none. Uses the criteria recorded with the score, which are the vacancy's
 * stored criteria.
 */
export function g4ForRecord(
  record: ScoreOkRecord,
  dataset: G4Dataset,
): G4TagResult[] {
  return githubOnlyMetTags(dataset, record).map((tag) => {
    const mapped = criteriaMentioningTag(
      record.criteria,
      tag,
      dataset.taxonomy,
    );
    return {
      tag,
      mapped: mapped.length > 0,
      criterionIds: mapped.map((c) => c.id),
      credited: mapped.some((c) => c.score > 0),
      citedGithub: mapped.some((c) =>
        c.quotes.some((q) => q.source === 'github'),
      ),
    };
  });
}
