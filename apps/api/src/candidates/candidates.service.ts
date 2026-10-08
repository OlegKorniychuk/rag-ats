import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
}
