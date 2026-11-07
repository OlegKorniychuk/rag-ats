import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CandidateSearchResult } from '@rag-ats/shared';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
} from '../../db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type Candidate,
  type CandidatesRepository,
} from '../../db/repositories/candidates.repository.js';
import { LlmClient } from '../../llm/llm-client.js';
import { rankCandidates } from './rank-candidates.js';
import {
  MAX_RESULTS,
  MAX_SNIPPETS,
  SEARCH_CHUNK_LIMIT,
  SEARCH_MIN_SIMILARITY,
} from './search.constants.js';

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Result as the repositories return it: `candidate` is not JSON-ified yet. */
export type CandidateSearchHit = Omit<CandidateSearchResult, 'candidate'> & {
  candidate: Candidate;
};

@Injectable()
export class CandidateSearchService {
  private readonly logger = new Logger(CandidateSearchService.name);

  constructor(
    @Inject(CANDIDATE_CHUNKS_REPOSITORY)
    private readonly chunks: CandidateChunksRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    private readonly llm: LlmClient,
    @Inject(SEARCH_MIN_SIMILARITY) private readonly minSimilarity: number,
  ) {}

  /**
   * Semantic search over the shared pool: embeds the query, takes the nearest
   * chunks and returns the matching candidates best first, each with its best
   * snippets. Candidates that aren't embedded yet cannot match.
   */
  async search(query: string): Promise<CandidateSearchHit[]> {
    const vector = await this.embedQuery(query);
    const hits = await this.chunks.findNearest(vector, SEARCH_CHUNK_LIMIT);
    const ranked = rankCandidates(hits, {
      minSimilarity: this.minSimilarity,
      maxCandidates: MAX_RESULTS,
      maxSnippets: MAX_SNIPPETS,
    });
    if (ranked.length === 0) return [];

    const found = await this.candidates.findByIds(
      ranked.map((r) => r.candidateId),
    );
    const byId = new Map(found.map((c) => [c.id, c]));

    const results: CandidateSearchHit[] = [];
    for (const r of ranked) {
      const candidate = byId.get(r.candidateId);
      // Deleted between the vector search and the hydration.
      if (!candidate) continue;
      results.push({
        candidate,
        similarity: round3(r.similarity),
        snippets: r.snippets.map((s) => ({
          source: s.source,
          text: s.text,
          similarity: round3(s.similarity),
        })),
      });
    }
    return results;
  }

  private async embedQuery(query: string): Promise<number[]> {
    try {
      const { vectors } = await this.llm.embed([query]);
      return vectors[0];
    } catch (error) {
      // Never log the query or the key.
      this.logger.error(
        `Embedding the search query failed: ${
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException(
        'Search is temporarily unavailable',
      );
    }
  }
}
