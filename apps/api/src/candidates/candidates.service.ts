import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { JobsService } from '../jobs/jobs.service.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../db/repositories/cv-documents.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type Candidate,
  type CandidatesRepository,
} from '../db/repositories/candidates.repository.js';

@Injectable()
export class CandidatesService {
  constructor(
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidatesRepository: CandidatesRepository,
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocumentsRepository: CvDocumentsRepository,
    private readonly jobs: JobsService,
  ) {}

  async findAll(): Promise<Candidate[]> {
    return this.candidatesRepository.findAll();
  }

  async findOne(id: string): Promise<Candidate> {
    const candidate = await this.candidatesRepository.findById(id);

    if (!candidate) {
      throw new NotFoundException('Candidate not found');
    }

    return candidate;
  }

  async findLatestCv(
    candidateId: string,
  ): Promise<{ filename: string; content: Buffer }> {
    const cv =
      await this.cvDocumentsRepository.findLatestContentByCandidate(
        candidateId,
      );

    // Unknown candidate and (invariant-violating) candidate without a CV are
    // both reported as 404: the client cannot act on the difference.
    if (!cv) {
      throw new NotFoundException('Candidate not found');
    }

    return cv;
  }

  async reparse(id: string): Promise<Candidate> {
    const cvDocumentId = await this.markPending(id);
    // After commit, so the worker sees `pending`. If this throws, the
    // candidate stays `pending` and the startup sweep re-enqueues it.
    await this.jobs.enqueueParse(id, cvDocumentId);
    return this.findOne(id);
  }

  @Transactional()
  private async markPending(id: string): Promise<string> {
    const state = await this.candidatesRepository.findParseState(id);
    if (!state) {
      throw new NotFoundException('Candidate not found');
    }
    if (state.parseStatus === 'pending' || state.parseStatus === 'parsing') {
      throw new ConflictException('CV parsing is already in progress');
    }
    await this.candidatesRepository.setParseStatus(id, 'pending');
    return state.latestCvDocumentId;
  }
}
