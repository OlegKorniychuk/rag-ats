import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
}
