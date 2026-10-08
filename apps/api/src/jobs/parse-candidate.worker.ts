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
import { CvProfileParser, LlmParseError } from '../llm/cv-profile-parser.js';
import type { ParseCandidateJob } from './jobs.constants.js';

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
      // Slow network call: deliberately outside any DB transaction.
      const profile = await this.parser.parse(text);
      await this.saveIfLatest(candidateId, cvDocumentId, profile);
    } catch (error) {
      await this.recordFailure(candidateId, cvDocumentId, error);
    }
  }

  @Transactional()
  private async saveIfLatest(
    candidateId: string,
    cvDocumentId: string,
    profile: ParsedProfile,
  ): Promise<void> {
    const current = await this.candidates.findParseState(candidateId);
    if (current?.latestCvDocumentId !== cvDocumentId) {
      this.logger.log(
        `Dropping parse result for candidate ${candidateId}: CV ${cvDocumentId} is no longer the latest`,
      );
      return;
    }
    await this.candidates.saveParsedProfile(candidateId, cvDocumentId, profile);
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
