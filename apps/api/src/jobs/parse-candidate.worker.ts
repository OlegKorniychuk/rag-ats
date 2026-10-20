import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
  type ParsedProfile,
} from '../db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../db/repositories/cv-documents.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import { GithubProfileFetcher } from '../github/github-profile-fetcher.js';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { parseGithubUsername } from '../github/github-username.js';
import { CvProfileParser, LlmParseError } from '../llm/cv-profile-parser.js';
import type { ParseCandidateJob } from './jobs.constants.js';
import { JobsService } from './jobs.service.js';

export const GENERIC_PARSE_ERROR = 'Could not parse the CV';

@Injectable()
export class ParseCandidateWorker {
  private readonly logger = new Logger(ParseCandidateWorker.name);

  constructor(
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocuments: CvDocumentsRepository,
    private readonly parser: CvProfileParser,
    private readonly githubFetcher: GithubProfileFetcher,
    @Inject(SCORES_REPOSITORY)
    private readonly scores: ScoresRepository,
    private readonly jobs: JobsService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Runs one job inside its own CLS context: jobs execute outside any HTTP
   * request, and the repositories / @Transactional() need an active context.
   */
  handle(job: ParseCandidateJob): Promise<void> {
    return this.cls.run(() => this.process(job));
  }

  private async process({
    candidateId,
    cvDocumentId,
  }: ParseCandidateJob): Promise<void> {
    const state = await this.candidates.findParseState(candidateId);
    if (!state) return;
    // Stale: a newer CV exists and its own job owns the work.
    if (state.latestCvDocumentId !== cvDocumentId) return;
    // Duplicate: this CV has already been parsed.
    if (
      state.parseStatus === 'parsed' &&
      state.parsedCvDocumentId === cvDocumentId
    ) {
      return;
    }

    try {
      // Guarded: if a newer job already finished (`parsed`), stop without an
      // LLM call instead of regressing the status to `parsing`.
      if (!(await this.candidates.markParsing(candidateId))) return;
      const text = await this.cvDocuments.findTextById(cvDocumentId);
      if (text === null) throw new Error('CV document not found');
      // Slow network calls: deliberately outside any DB transaction. GitHub
      // never throws (failures become a snapshot status), so it cannot fail
      // the parse; no usable URL means no GitHub call at all.
      const username = parseGithubUsername(state.githubUrl);
      const snapshot = username
        ? await this.githubFetcher.fetch(username)
        : null;
      const profile = await this.parser.parse(text, snapshot);
      const applicationIds = await this.saveIfLatest(
        candidateId,
        cvDocumentId,
        profile,
        snapshot,
      );
      // After the commit, so the scoring workers see the parsed profile.
      await this.enqueueScores(candidateId, applicationIds);
    } catch (error) {
      await this.recordFailure(candidateId, cvDocumentId, error);
    }
  }

  /**
   * Saves the profile and, in the same transaction, resets all of the
   * candidate's scores to `pending` (their results stay, now stale). Returns
   * the application ids to score once the transaction has committed.
   */
  @Transactional()
  private async saveIfLatest(
    candidateId: string,
    cvDocumentId: string,
    profile: ParsedProfile,
    snapshot: GithubSnapshot | null,
  ): Promise<string[]> {
    const current = await this.candidates.findParseState(candidateId);
    if (current?.latestCvDocumentId !== cvDocumentId) {
      this.logger.log(
        `Dropping parse result for candidate ${candidateId}: CV ${cvDocumentId} is no longer the latest`,
      );
      return [];
    }
    await this.candidates.saveParsedProfile(
      candidateId,
      cvDocumentId,
      profile,
      snapshot,
    );
    return this.scores.resetPendingForCandidate(candidateId);
  }

  /**
   * The profile is already saved, so a failed enqueue must not fail the parse:
   * the scores are `pending` and the startup sweep re-enqueues them.
   */
  private async enqueueScores(
    candidateId: string,
    applicationIds: string[],
  ): Promise<void> {
    try {
      await this.jobs.enqueueScores(applicationIds);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue scoring for candidate ${candidateId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async recordFailure(
    candidateId: string,
    cvDocumentId: string,
    error: unknown,
  ): Promise<void> {
    // Log the real error (never the CV text or the key); store only a safe message.
    this.logger.error(
      `Parsing CV ${cvDocumentId} for candidate ${candidateId} failed: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'unknown error'
      }`,
    );
    try {
      const state = await this.candidates.findParseState(candidateId);
      if (state?.latestCvDocumentId !== cvDocumentId) return;
      const message =
        error instanceof LlmParseError ? error.message : GENERIC_PARSE_ERROR;
      await this.candidates.setParseStatus(candidateId, 'failed', message);
    } catch (recordError) {
      this.logger.error(
        `Could not record parse failure for candidate ${candidateId}: ${
          recordError instanceof Error ? recordError.message : 'unknown error'
        }`,
      );
    }
  }
}
