import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CriterionMatch,
  MatchMode,
  MatchSnippet,
  VacancyCriterion,
  VacancyMatch,
  VacancyMatchesResponse,
} from '@rag-ats/shared';
import { SEARCH_MIN_SIMILARITY } from '../../candidates/search/search.constants.js';
import { rankCandidates } from '../../candidates/search/rank-candidates.js';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
  type ChunkHit,
} from '../../db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type Candidate,
  type CandidatesRepository,
} from '../../db/repositories/candidates.repository.js';
import {
  VACANCIES_REPOSITORY,
  type VacanciesRepository,
} from '../../db/repositories/vacancies.repository.js';
import { CriteriaExtractor } from '../../llm/criteria-extractor.js';
import { LlmClient } from '../../llm/llm-client.js';
import { rankByCriteria } from '../../rag/rank-by-criteria.js';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import { VacanciesService } from '../vacancies.service.js';
import {
  MATCH_FLOOR_TOKEN,
  MAX_MATCH_SNIPPETS,
  MAX_MATCHES,
  PER_CRITERION_CHUNK_LIMIT,
  WHOLE_TEXT_CHUNK_LIMIT,
} from './matches.constants.js';

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** A match as the repositories return it: `candidate` is not JSON-ified yet. */
export type VacancyMatchHit = Omit<VacancyMatch, 'candidate'> & {
  candidate: Candidate;
};

/** Response as the service returns it, before serialisation. */
export type VacancyMatchesHits = Omit<VacancyMatchesResponse, 'matches'> & {
  matches: VacancyMatchHit[];
};

/** A match before the candidate is loaded. */
type RankedMatch = Omit<VacancyMatchHit, 'candidate'> & { candidateId: string };

const UNAVAILABLE = 'Matching is temporarily unavailable';

@Injectable()
export class VacancyMatchService {
  private readonly logger = new Logger(VacancyMatchService.name);

  constructor(
    private readonly vacancies: VacanciesService,
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacanciesRepository: VacanciesRepository,
    @Inject(CANDIDATE_CHUNKS_REPOSITORY)
    private readonly chunks: CandidateChunksRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    private readonly llm: LlmClient,
    private readonly extractor: CriteriaExtractor,
    @Inject(MATCH_FLOOR_TOKEN) private readonly matchFloor: number,
    @Inject(SEARCH_MIN_SIMILARITY) private readonly minSimilarity: number,
  ) {}

  /**
   * Ranks the shared pool for a vacancy of the recruiter, skipping candidates
   * already on its pipeline. See `MatchMode` for the two retrieval modes.
   */
  async findMatches(
    recruiterId: string,
    vacancyId: string,
    mode: MatchMode = 'criteria',
  ): Promise<VacancyMatchesHits> {
    const vacancy = await this.vacancies.findOne(recruiterId, vacancyId);
    // A closed vacancy takes no candidates, and matching costs LLM calls.
    if (vacancy.status === 'closed') {
      throw new ConflictException('Vacancy is closed');
    }

    const ranked =
      mode === 'criteria'
        ? await this.rankByCriteria(
            vacancy.id,
            vacancy.title,
            vacancy.requirements,
          )
        : await this.rankWholeText(
            vacancy.id,
            vacancy.title,
            vacancy.requirements,
          );

    return { mode, matches: await this.hydrate(ranked) };
  }

  private async rankByCriteria(
    vacancyId: string,
    title: string,
    requirements: string,
  ): Promise<RankedMatch[]> {
    const criteria = await this.currentCriteria(vacancyId, title, requirements);
    const vectors = await this.embed(criteria.map((c) => c.text));
    const hitsPerCriterion = await Promise.all(
      vectors.map((vector) =>
        this.chunks.findNearest(vector, PER_CRITERION_CHUNK_LIMIT, {
          excludeVacancyId: vacancyId,
        }),
      ),
    );

    return rankByCriteria(criteria, hitsPerCriterion, {
      floor: this.matchFloor,
      maxCandidates: MAX_MATCHES,
      maxSnippets: MAX_MATCH_SNIPPETS,
    }).map((r) => ({
      candidateId: r.candidateId,
      score: round3(r.score),
      criteria: r.criteria.map((c): CriterionMatch => ({
        ...c,
        similarity: c.similarity === null ? null : round3(c.similarity),
      })),
      snippets: r.snippets.map((s): MatchSnippet => ({
        source: s.source,
        text: s.text,
        similarity: round3(s.similarity),
        criterionId: s.criterionId,
      })),
    }));
  }

  private async rankWholeText(
    vacancyId: string,
    title: string,
    requirements: string,
  ): Promise<RankedMatch[]> {
    const [vector] = await this.embed([`${title}\n${requirements}`]);
    const hits: ChunkHit[] = await this.chunks.findNearest(
      vector,
      WHOLE_TEXT_CHUNK_LIMIT,
      { excludeVacancyId: vacancyId },
    );

    return rankCandidates(hits, {
      minSimilarity: this.minSimilarity,
      maxCandidates: MAX_MATCHES,
      maxSnippets: MAX_MATCH_SNIPPETS,
    }).map((r) => ({
      candidateId: r.candidateId,
      score: round3(r.similarity),
      criteria: [],
      snippets: r.snippets.map((s): MatchSnippet => ({
        source: s.source,
        text: s.text,
        similarity: round3(s.similarity),
        criterionId: null,
      })),
    }));
  }

  /**
   * The vacancy's criteria for its current text: the stored ones when their
   * hash still matches, else extracted now and stored so scoring reuses them.
   * A lost hash race (the vacancy was edited meanwhile) only means the fresh
   * criteria serve this response alone.
   */
  private async currentCriteria(
    vacancyId: string,
    title: string,
    requirements: string,
  ): Promise<VacancyCriterion[]> {
    const hash = vacancyCriteriaHash(title, requirements);
    const stored = await this.vacanciesRepository.findCriteria(vacancyId);
    if (stored?.criteriaHash === hash && stored.criteria?.length) {
      return stored.criteria;
    }

    let criteria: VacancyCriterion[];
    try {
      ({ criteria } = await this.extractor.extract(title, requirements));
    } catch (error) {
      this.logFailure('Extracting vacancy criteria for matching failed', error);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    await this.vacanciesRepository.saveCriteria(vacancyId, criteria, hash);
    return criteria;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    try {
      const { vectors } = await this.llm.embed(texts);
      return vectors;
    } catch (error) {
      this.logFailure('Embedding the vacancy for matching failed', error);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  private async hydrate(ranked: RankedMatch[]): Promise<VacancyMatchHit[]> {
    if (ranked.length === 0) return [];
    const found = await this.candidates.findByIds(
      ranked.map((r) => r.candidateId),
    );
    const byId = new Map(found.map((c) => [c.id, c]));

    const matches: VacancyMatchHit[] = [];
    for (const { candidateId, ...rest } of ranked) {
      const candidate = byId.get(candidateId);
      // Deleted between the vector search and the hydration.
      if (!candidate) continue;
      matches.push({ candidate, ...rest });
    }
    return matches;
  }

  /** Logs the error's name and message only: never vacancy text or the key. */
  private logFailure(what: string, error: unknown): void {
    this.logger.error(
      `${what}: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'unknown error'
      }`,
    );
  }
}
