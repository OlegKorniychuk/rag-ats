import { jest } from '@jest/globals';
import {
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { VacancyCriterion } from '@rag-ats/shared';
import type { CandidateChunksRepository } from '../../db/repositories/candidate-chunks.repository.js';
import type { CandidatesRepository } from '../../db/repositories/candidates.repository.js';
import type { VacanciesRepository } from '../../db/repositories/vacancies.repository.js';
import type { CriteriaExtractor } from '../../llm/criteria-extractor.js';
import type { LlmClient } from '../../llm/llm-client.js';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import type { VacanciesService } from '../vacancies.service.js';
import { VacancyMatchService } from './vacancy-match.service.js';

const TITLE = 'Platform Engineer';
const REQUIREMENTS = 'Kubernetes and Terraform';
const HASH = vacancyCriteriaHash(TITLE, REQUIREMENTS);
const CRITERIA: VacancyCriterion[] = [
  { id: 'c1', text: 'Kubernetes', importance: 'must' },
  { id: 'c2', text: 'Terraform', importance: 'nice' },
];

// Only the fields the service reads; the rest of Candidate is irrelevant here.
const CANDIDATE = { id: 'cand-1', name: 'Alex' } as never;

function makeService(
  options: {
    status?: 'open' | 'closed';
    stored?: {
      criteria: VacancyCriterion[] | null;
      criteriaHash: string | null;
    } | null;
  } = {},
) {
  const findOne = jest.fn<VacanciesService['findOne']>().mockResolvedValue({
    id: 'v1',
    recruiterId: 'r1',
    title: TITLE,
    requirements: REQUIREMENTS,
    status: options.status ?? 'open',
  } as never);
  const findCriteria = jest
    .fn<VacanciesRepository['findCriteria']>()
    .mockResolvedValue(
      options.stored === undefined
        ? {
            title: TITLE,
            requirements: REQUIREMENTS,
            ...{ criteriaHash: HASH, criteria: CRITERIA },
          }
        : options.stored === null
          ? null
          : { title: TITLE, requirements: REQUIREMENTS, ...options.stored },
    );
  const saveCriteria = jest
    .fn<VacanciesRepository['saveCriteria']>()
    .mockResolvedValue(true);
  const findNearest = jest
    .fn<CandidateChunksRepository['findNearest']>()
    .mockImplementation(async (vector) =>
      vector[0] === 1
        ? [
            {
              candidateId: 'cand-1',
              source: 'cv',
              text: 'Kube',
              similarity: 0.8,
            },
          ]
        : [],
    );
  const findByIds = jest
    .fn<CandidatesRepository['findByIds']>()
    .mockResolvedValue([CANDIDATE]);
  const embed = jest
    .fn<LlmClient['embed']>()
    .mockImplementation(async (texts) => ({
      vectors: texts.map((_, i) => (i === 0 ? [1, 0] : [0, 1])),
      usage: null,
    }));
  const extract = jest
    .fn<CriteriaExtractor['extract']>()
    .mockResolvedValue({ criteria: CRITERIA, usage: null });

  const service = new VacancyMatchService(
    { findOne } as unknown as VacanciesService,
    { findCriteria, saveCriteria } as unknown as VacanciesRepository,
    { findNearest } as unknown as CandidateChunksRepository,
    { findByIds } as unknown as CandidatesRepository,
    { embed } as unknown as LlmClient,
    { extract } as unknown as CriteriaExtractor,
    0.3,
    0.3,
  );
  return {
    service,
    findOne,
    saveCriteria,
    findNearest,
    embed,
    extract,
    findByIds,
  };
}

describe('VacancyMatchService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reuses current stored criteria without extracting', async () => {
    const { service, extract, saveCriteria, embed } = makeService();

    const result = await service.findMatches('r1', 'v1');

    expect(extract).not.toHaveBeenCalled();
    expect(saveCriteria).not.toHaveBeenCalled();
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(['Kubernetes', 'Terraform']);
    expect(result.mode).toBe('criteria');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].candidate).toBe(CANDIDATE);
    expect(result.matches[0].criteria.map((c) => c.matched)).toEqual([
      true,
      false,
    ]);
  });

  it.each([
    ['are absent', { criteria: null, criteriaHash: null }],
    ['are stale', { criteria: CRITERIA, criteriaHash: 'old-hash' }],
    ['are empty', { criteria: [], criteriaHash: HASH }],
  ])('extracts inline and stores criteria that %s', async (_label, stored) => {
    const { service, extract, saveCriteria } = makeService({ stored });

    await service.findMatches('r1', 'v1');

    expect(extract).toHaveBeenCalledWith(TITLE, REQUIREMENTS);
    expect(saveCriteria).toHaveBeenCalledWith('v1', CRITERIA, HASH);
  });

  it('uses the fresh criteria when the store loses the hash race', async () => {
    const { service, saveCriteria, embed } = makeService({ stored: null });
    saveCriteria.mockResolvedValue(false);

    const result = await service.findMatches('r1', 'v1');

    expect(embed).toHaveBeenCalledWith(['Kubernetes', 'Terraform']);
    expect(result.matches).toHaveLength(1);
  });

  it('queries per criterion, excluding the vacancy applicants', async () => {
    const { service, findNearest } = makeService();

    await service.findMatches('r1', 'v1', 'criteria');

    expect(findNearest).toHaveBeenCalledTimes(2);
    expect(findNearest).toHaveBeenCalledWith([1, 0], 30, {
      excludeVacancyId: 'v1',
    });
  });

  it('whole_text mode embeds title and requirements once and skips criteria', async () => {
    const { service, embed, findNearest, extract } = makeService();

    const result = await service.findMatches('r1', 'v1', 'whole_text');

    expect(extract).not.toHaveBeenCalled();
    expect(embed).toHaveBeenCalledWith([`${TITLE}\n${REQUIREMENTS}`]);
    expect(findNearest).toHaveBeenCalledTimes(1);
    expect(findNearest).toHaveBeenCalledWith([1, 0], 50, {
      excludeVacancyId: 'v1',
    });
    expect(result.mode).toBe('whole_text');
    expect(result.matches[0]).toMatchObject({
      score: 0.8,
      criteria: [],
      snippets: [{ text: 'Kube', criterionId: null }],
    });
  });

  it('skips ranked candidates that no longer exist', async () => {
    const { service, findByIds } = makeService();
    findByIds.mockResolvedValue([]);

    const result = await service.findMatches('r1', 'v1');

    expect(result.matches).toEqual([]);
  });

  it('propagates the not-found error of an unowned vacancy', async () => {
    const { service, findOne, embed } = makeService();
    findOne.mockRejectedValue(new NotFoundException('Vacancy not found'));

    await expect(service.findMatches('r1', 'v1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(embed).not.toHaveBeenCalled();
  });

  it('rejects a closed vacancy before any LLM call', async () => {
    const { service, embed, extract } = makeService({ status: 'closed' });

    await expect(service.findMatches('r1', 'v1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(embed).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('maps an embeddings failure to 503 without logging vacancy text', async () => {
    const { service, embed } = makeService();
    embed.mockRejectedValue(new Error('boom'));

    await expect(service.findMatches('r1', 'v1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const logged = JSON.stringify(
      (Logger.prototype.error as jest.Mock).mock.calls,
    );
    expect(logged).toContain('boom');
    expect(logged).not.toContain(REQUIREMENTS);
  });

  it('maps a criteria extraction failure to 503 and stores nothing', async () => {
    const { service, extract, saveCriteria } = makeService({ stored: null });
    extract.mockRejectedValue(new Error('boom'));

    await expect(service.findMatches('r1', 'v1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(saveCriteria).not.toHaveBeenCalled();
  });
});
